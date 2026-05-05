// Thin wrapper over libgrpc-c for Firestore-style RPCs.
//
// Auth model (matches google-cloud-go semantics):
//   - use_tls=true  -> grpc_google_default_credentials_create(null)
//                      This is the single call that makes the service
//                      Workload Identity aware on Cloud Run / GKE: ADC picks
//                      up the metadata-server credentials automatically.
//   - use_tls=false -> insecure channel + "authorization: Bearer owner"
//                      metadata, which the Firestore emulator requires.
//
// Thread safety: grpc_channel_create_call is NOT thread-safe in libgrpc-c, so
// call creation is serialized via an internal mutex. The completion queue is
// owned by the caller and never touched under the mutex.

const std = @import("std");
const Allocator = std.mem.Allocator;

pub const c = @cImport({
    @cInclude("grpc/grpc.h");
    @cInclude("grpc/grpc_security.h");
    @cInclude("grpc/byte_buffer_reader.h");
    @cInclude("grpc/support/time.h");
    @cInclude("grpc/slice.h");
});

const log = std.log.scoped(.grpc);

pub const GrpcError = error{
    ChannelCreateFailed,
    CredentialsCreateFailed,
    CqCreateFailed,
    CallCreateFailed,
    BatchFailed,
    CallError,
    ReaderInitFailed,
    OutOfMemory,
    RpcFailed,
    TooManyMetadata,
};

/// Caller-supplied initial-metadata entry. Both fields are null-terminated so
/// they can be passed straight to `grpc_slice_from_static_string`; the caller
/// owns the memory and must keep it alive for the duration of the RPC.
pub const Metadata = struct {
    key: [:0]const u8,
    value: [:0]const u8,
};

/// Hard cap on the number of initial-metadata entries we send. One slot is
/// reserved for the auth header; the rest are caller-supplied (e.g. Firestore's
/// `x-goog-request-params` routing header). Sized to leave headroom without
/// growing the per-call stack frame.
const MAX_INITIAL_METADATA: usize = 8;

pub const GrpcChannel = struct {
    channel: *c.grpc_channel,
    use_tls: bool,
    mutex: std.Thread.Mutex = .{},

    pub fn createCq() GrpcError!*c.grpc_completion_queue {
        return c.grpc_completion_queue_create_for_next(null) orelse return error.CqCreateFailed;
    }

    pub fn destroyCq(cq: *c.grpc_completion_queue) void {
        c.grpc_completion_queue_destroy(cq);
    }

    pub fn init(host: [:0]const u8, use_tls: bool) GrpcError!GrpcChannel {
        c.grpc_init();
        const creds: *c.grpc_channel_credentials = if (use_tls) blk: {
            // Workload Identity / ADC: reads GOOGLE_APPLICATION_CREDENTIALS,
            // the GCE metadata server, or the workload identity pool token —
            // whichever is present at runtime.
            break :blk c.grpc_google_default_credentials_create(null) orelse
                return error.CredentialsCreateFailed;
        } else blk: {
            break :blk c.grpc_insecure_credentials_create() orelse
                return error.CredentialsCreateFailed;
        };
        defer c.grpc_channel_credentials_release(creds);

        const channel = c.grpc_channel_create(host.ptr, creds, null) orelse
            return error.ChannelCreateFailed;

        return .{ .channel = channel, .use_tls = use_tls };
    }

    pub fn deinit(self: *GrpcChannel) void {
        c.grpc_channel_destroy(self.channel);
    }

    fn makeDeadline(seconds: i64) c.gpr_timespec {
        return c.gpr_time_add(
            c.gpr_now(c.GPR_CLOCK_REALTIME),
            c.gpr_time_from_seconds(seconds, c.GPR_TIMESPAN),
        );
    }

    fn createCall(self: *GrpcChannel, cq: *c.grpc_completion_queue, method: [:0]const u8, deadline: c.gpr_timespec) GrpcError!*c.grpc_call {
        const method_slice = c.grpc_slice_from_static_string(method.ptr);
        return c.grpc_channel_create_call(
            self.channel,
            null,
            0,
            cq,
            method_slice,
            null,
            deadline,
            null,
        ) orelse return error.CallCreateFailed;
    }

    fn sliceStartPtr(slice: c.grpc_slice) [*c]const u8 {
        if (slice.refcount != null) {
            return slice.data.refcounted.bytes;
        } else {
            return &slice.data.inlined.bytes;
        }
    }

    fn sliceLength(slice: c.grpc_slice) usize {
        if (slice.refcount != null) {
            return slice.data.refcounted.length;
        } else {
            return slice.data.inlined.length;
        }
    }

    pub fn readByteBuffer(recv_bb: *c.grpc_byte_buffer, arena: Allocator) GrpcError![]const u8 {
        var reader: c.grpc_byte_buffer_reader = undefined;
        if (c.grpc_byte_buffer_reader_init(&reader, recv_bb) == 0) {
            return error.ReaderInitFailed;
        }
        const slice = c.grpc_byte_buffer_reader_readall(&reader);
        defer c.grpc_slice_unref(slice);
        c.grpc_byte_buffer_reader_destroy(&reader);

        const ptr = sliceStartPtr(slice);
        const len = sliceLength(slice);
        if (len == 0) return &[_]u8{};

        const buf = arena.alloc(u8, len) catch return error.OutOfMemory;
        @memcpy(buf, ptr[0..len]);
        return buf;
    }

    fn buildAuthMetadata(self: *GrpcChannel) struct { md: [1]c.grpc_metadata, count: usize } {
        if (!self.use_tls) {
            return .{
                .md = .{blk: {
                    var md = std.mem.zeroes(c.grpc_metadata);
                    md.key = c.grpc_slice_from_static_string("authorization");
                    md.value = c.grpc_slice_from_static_string("Bearer owner");
                    break :blk md;
                }},
                .count = 1,
            };
        }
        return .{
            .md = .{std.mem.zeroes(c.grpc_metadata)},
            .count = 0,
        };
    }

    pub fn callUnary(
        self: *GrpcChannel,
        cq: *c.grpc_completion_queue,
        method: [:0]const u8,
        request: []const u8,
        arena: Allocator,
        timeout_seconds: i64,
        extra_metadata: []const Metadata,
    ) GrpcError![]const u8 {
        self.mutex.lock();
        const call = self.createCall(cq, method, makeDeadline(timeout_seconds)) catch |err| {
            self.mutex.unlock();
            return err;
        };
        defer c.grpc_call_unref(call);

        var recv_metadata: c.grpc_metadata_array = undefined;
        c.grpc_metadata_array_init(&recv_metadata);
        defer c.grpc_metadata_array_destroy(&recv_metadata);

        var req_slice = c.grpc_slice_from_copied_buffer(@ptrCast(request.ptr), request.len);
        const req_bb = c.grpc_raw_byte_buffer_create(&req_slice, 1) orelse return error.CallError;
        defer c.grpc_byte_buffer_destroy(req_bb);
        c.grpc_slice_unref(req_slice);

        const auth = self.buildAuthMetadata();

        // Combined initial metadata: [auth?] ++ extra. The slices reference
        // memory owned by the caller (Config) or static strings, so they remain
        // valid for the lifetime of the batch (the function blocks on pollCq).
        var md_buf: [MAX_INITIAL_METADATA]c.grpc_metadata = std.mem.zeroes([MAX_INITIAL_METADATA]c.grpc_metadata);
        const md_total = auth.count + extra_metadata.len;
        if (md_total > md_buf.len) {
            self.mutex.unlock();
            return error.TooManyMetadata;
        }
        var md_idx: usize = 0;
        if (auth.count > 0) {
            md_buf[md_idx] = auth.md[0];
            md_idx += 1;
        }
        for (extra_metadata) |em| {
            var md = std.mem.zeroes(c.grpc_metadata);
            md.key = c.grpc_slice_from_static_string(em.key.ptr);
            md.value = c.grpc_slice_from_static_string(em.value.ptr);
            md_buf[md_idx] = md;
            md_idx += 1;
        }

        var ops: [6]c.grpc_op = std.mem.zeroes([6]c.grpc_op);

        ops[0].op = c.GRPC_OP_SEND_INITIAL_METADATA;
        ops[0].data.send_initial_metadata.count = md_total;
        ops[0].data.send_initial_metadata.metadata = if (md_total > 0) &md_buf else null;

        ops[1].op = c.GRPC_OP_SEND_MESSAGE;
        ops[1].data.send_message.send_message = req_bb;

        ops[2].op = c.GRPC_OP_SEND_CLOSE_FROM_CLIENT;

        ops[3].op = c.GRPC_OP_RECV_INITIAL_METADATA;
        ops[3].data.recv_initial_metadata.recv_initial_metadata = &recv_metadata;

        var recv_bb: ?*c.grpc_byte_buffer = null;
        ops[4].op = c.GRPC_OP_RECV_MESSAGE;
        ops[4].data.recv_message.recv_message = &recv_bb;

        var status_code: c.grpc_status_code = undefined;
        var status_details: c.grpc_slice = undefined;
        ops[5].op = c.GRPC_OP_RECV_STATUS_ON_CLIENT;
        ops[5].data.recv_status_on_client.trailing_metadata = &recv_metadata;
        ops[5].data.recv_status_on_client.status = &status_code;
        ops[5].data.recv_status_on_client.status_details = &status_details;
        ops[5].data.recv_status_on_client.error_string = null;

        const err = c.grpc_call_start_batch(call, &ops, 6, @ptrFromInt(1), null);
        self.mutex.unlock();
        if (err != c.GRPC_CALL_OK) return error.BatchFailed;

        try pollCq(cq, timeout_seconds + 5);

        if (status_code != c.GRPC_STATUS_OK) {
            const detail_ptr = sliceStartPtr(status_details);
            const detail_len = sliceLength(status_details);
            if (detail_len > 0) {
                log.err("rpc failed: status={d} detail={s}", .{ status_code, detail_ptr[0..detail_len] });
            } else {
                log.err("rpc failed: status={d}", .{status_code});
            }
            c.grpc_slice_unref(status_details);
            if (recv_bb) |bb| c.grpc_byte_buffer_destroy(bb);
            return error.RpcFailed;
        }
        c.grpc_slice_unref(status_details);

        if (recv_bb) |bb| {
            defer c.grpc_byte_buffer_destroy(bb);
            return readByteBuffer(bb, arena);
        }
        return &[_]u8{};
    }
};

pub fn pollCq(cq: *c.grpc_completion_queue, timeout_seconds: i64) GrpcError!void {
    const deadline = c.gpr_time_add(
        c.gpr_now(c.GPR_CLOCK_REALTIME),
        c.gpr_time_from_seconds(timeout_seconds, c.GPR_TIMESPAN),
    );
    const ev = c.grpc_completion_queue_next(cq, deadline, null);
    if (ev.type != c.GRPC_OP_COMPLETE or ev.success == 0) {
        return error.BatchFailed;
    }
}
