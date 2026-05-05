// Firestore client + environment-driven config.
//
// Env vars:
//   FIRESTORE_PROJECT_ID   -> project id (default "demo-mocktail")
//   FIRESTORE_USE_TLS      -> "true"/"1" selects production (Workload Identity)
//   FIRESTORE_EMULATOR_HOST-> host:port for the emulator; used only when
//                             FIRESTORE_USE_TLS is NOT set, so flipping TLS on
//                             overrides a stale emulator env.
//
// Host resolution:
//   use_tls=true  -> firestore.googleapis.com:443
//   use_tls=false -> FIRESTORE_EMULATOR_HOST if set, else production host

const std = @import("std");
const grpc = @import("grpc.zig");

pub const Config = struct {
    project: []const u8,
    host: [:0]const u8,
    database: [:0]const u8, // "projects/<id>/databases/<name>"; <name>=(default) unless FIRESTORE_DB is set
    // `x-goog-request-params` value, e.g. "project_id=foo&database_id=mocktail".
    // Required for named databases; without it the backend rejects RPCs with
    // INVALID_ARGUMENT "Missing routing header".
    routing_params: [:0]const u8,
    use_tls: bool,
    allocator: std.mem.Allocator,

    pub const Error = error{OutOfMemory};

    const default_project = "demo-mocktail";
    const default_prod_host: [:0]const u8 = "firestore.googleapis.com:443";

    pub fn fromEnv(allocator: std.mem.Allocator) Error!Config {
        var env = std.process.getEnvMap(allocator) catch return Error.OutOfMemory;
        defer env.deinit();
        return fromEnvMap(allocator, &env);
    }

    pub fn fromEnvMap(allocator: std.mem.Allocator, env: *const std.process.EnvMap) Error!Config {
        const project_src = env.get("FIRESTORE_PROJECT_ID") orelse default_project;
        const project_dup = try allocator.dupe(u8, project_src);
        errdefer allocator.free(project_dup);

        const use_tls = parseBool(env.get("FIRESTORE_USE_TLS"));

        const host_dup: [:0]const u8 = blk: {
            if (!use_tls) {
                if (env.get("FIRESTORE_EMULATOR_HOST")) |v| {
                    break :blk try allocator.dupeZ(u8, v);
                }
            }
            break :blk try allocator.dupeZ(u8, default_prod_host);
        };
        errdefer allocator.free(host_dup);

        const db_name = env.get("FIRESTORE_DB") orelse "(default)";

        const database_dup = try std.fmt.allocPrintSentinel(
            allocator,
            "projects/{s}/databases/{s}",
            .{ project_dup, db_name },
            0,
        );
        errdefer allocator.free(database_dup);

        const routing_dup = try std.fmt.allocPrintSentinel(
            allocator,
            "project_id={s}&database_id={s}",
            .{ project_dup, db_name },
            0,
        );

        return .{
            .project = project_dup,
            .host = host_dup,
            .database = database_dup,
            .routing_params = routing_dup,
            .use_tls = use_tls,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Config) void {
        self.allocator.free(self.project);
        self.allocator.free(self.host);
        self.allocator.free(self.database);
        self.allocator.free(self.routing_params);
    }

    fn parseBool(maybe: ?[]const u8) bool {
        const v = maybe orelse return false;
        if (std.mem.eql(u8, v, "true")) return true;
        if (std.mem.eql(u8, v, "1")) return true;
        if (std.mem.eql(u8, v, "TRUE")) return true;
        if (std.mem.eql(u8, v, "True")) return true;
        return false;
    }
};

/// Thin Firestore client: owns a gRPC channel and exposes the unary methods
/// most WS handlers need. Handlers bring their own completion queue so RPCs
/// can run concurrently across threads/slots.
pub const Client = struct {
    config: Config,
    channel: grpc.GrpcChannel,

    pub fn init(allocator: std.mem.Allocator) !Client {
        const cfg = try Config.fromEnv(allocator);
        errdefer {
            var c = cfg;
            c.deinit();
        }
        const channel = try grpc.GrpcChannel.init(cfg.host, cfg.use_tls);
        return .{ .config = cfg, .channel = channel };
    }

    pub fn deinit(self: *Client) void {
        self.channel.deinit();
        self.config.deinit();
    }

    /// Initial metadata required for named-database routing. Backed by Config-
    /// owned memory so the slices remain valid for the duration of any RPC.
    fn routingMetadata(self: *const Client) [1]grpc.Metadata {
        return .{
            .{ .key = "x-goog-request-params", .value = self.config.routing_params },
        };
    }

    /// `/google.firestore.v1.Firestore/GetDocument`
    /// `request` is a pre-encoded GetDocumentRequest protobuf.
    pub fn getDocument(
        self: *Client,
        cq: *grpc.c.grpc_completion_queue,
        request: []const u8,
        arena: std.mem.Allocator,
    ) grpc.GrpcError![]const u8 {
        const md = self.routingMetadata();
        return self.channel.callUnary(
            cq,
            "/google.firestore.v1.Firestore/GetDocument",
            request,
            arena,
            30,
            &md,
        );
    }

    /// `/google.firestore.v1.Firestore/Commit`
    pub fn commit(
        self: *Client,
        cq: *grpc.c.grpc_completion_queue,
        request: []const u8,
        arena: std.mem.Allocator,
    ) grpc.GrpcError![]const u8 {
        const md = self.routingMetadata();
        return self.channel.callUnary(
            cq,
            "/google.firestore.v1.Firestore/Commit",
            request,
            arena,
            30,
            &md,
        );
    }
};

test "Config defaults" {
    const allocator = std.testing.allocator;
    var env = std.process.EnvMap.init(allocator);
    defer env.deinit();

    var cfg = try Config.fromEnvMap(allocator, &env);
    defer cfg.deinit();

    try std.testing.expectEqualStrings("demo-mocktail", cfg.project);
    try std.testing.expectEqualStrings("firestore.googleapis.com:443", cfg.host);
    try std.testing.expectEqualStrings("projects/demo-mocktail/databases/(default)", cfg.database);
    try std.testing.expectEqual(false, cfg.use_tls);
}

test "Config uses emulator host when set and tls is not forced" {
    const allocator = std.testing.allocator;
    var env = std.process.EnvMap.init(allocator);
    defer env.deinit();
    try env.put("FIRESTORE_EMULATOR_HOST", "localhost:8083");

    var cfg = try Config.fromEnvMap(allocator, &env);
    defer cfg.deinit();

    try std.testing.expectEqualStrings("localhost:8083", cfg.host);
    try std.testing.expectEqual(false, cfg.use_tls);
}

test "Config FIRESTORE_USE_TLS overrides a stale emulator host" {
    const allocator = std.testing.allocator;
    var env = std.process.EnvMap.init(allocator);
    defer env.deinit();
    try env.put("FIRESTORE_EMULATOR_HOST", "localhost:8083");
    try env.put("FIRESTORE_USE_TLS", "true");

    var cfg = try Config.fromEnvMap(allocator, &env);
    defer cfg.deinit();

    try std.testing.expectEqualStrings("firestore.googleapis.com:443", cfg.host);
    try std.testing.expectEqual(true, cfg.use_tls);
}

test "Config FIRESTORE_DB selects a named database" {
    const allocator = std.testing.allocator;
    var env = std.process.EnvMap.init(allocator);
    defer env.deinit();
    try env.put("FIRESTORE_DB", "mocktail");

    var cfg = try Config.fromEnvMap(allocator, &env);
    defer cfg.deinit();

    try std.testing.expectEqualStrings(
        "projects/demo-mocktail/databases/mocktail",
        cfg.database,
    );
}

test "Config emits routing_params for named-database backend routing" {
    const allocator = std.testing.allocator;
    var env = std.process.EnvMap.init(allocator);
    defer env.deinit();
    try env.put("FIRESTORE_PROJECT_ID", "firebase-cloud-491613");
    try env.put("FIRESTORE_DB", "mocktail");

    var cfg = try Config.fromEnvMap(allocator, &env);
    defer cfg.deinit();

    try std.testing.expectEqualStrings(
        "project_id=firebase-cloud-491613&database_id=mocktail",
        cfg.routing_params,
    );
}

test "Config routing_params falls back to (default) when FIRESTORE_DB unset" {
    const allocator = std.testing.allocator;
    var env = std.process.EnvMap.init(allocator);
    defer env.deinit();

    var cfg = try Config.fromEnvMap(allocator, &env);
    defer cfg.deinit();

    try std.testing.expectEqualStrings(
        "project_id=demo-mocktail&database_id=(default)",
        cfg.routing_params,
    );
}
