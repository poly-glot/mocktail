const std = @import("std");

// Generated protobuf-c sources (created by .devcontainer/post-create.sh from
// googleapis). The build depends on these living under ./proto.
const proto_c_sources = [_][]const u8{
    "google/api/annotations.pb-c.c",
    "google/api/client.pb-c.c",
    "google/api/field_behavior.pb-c.c",
    "google/api/http.pb-c.c",
    "google/api/launch_stage.pb-c.c",
    "google/api/routing.pb-c.c",
    "google/firestore/v1/aggregation_result.pb-c.c",
    "google/firestore/v1/bloom_filter.pb-c.c",
    "google/firestore/v1/common.pb-c.c",
    "google/firestore/v1/document.pb-c.c",
    "google/firestore/v1/explain_stats.pb-c.c",
    "google/firestore/v1/firestore.pb-c.c",
    "google/firestore/v1/pipeline.pb-c.c",
    "google/firestore/v1/query.pb-c.c",
    "google/firestore/v1/query_profile.pb-c.c",
    "google/firestore/v1/write.pb-c.c",
    "google/protobuf/any.pb-c.c",
    "google/protobuf/descriptor.pb-c.c",
    "google/protobuf/duration.pb-c.c",
    "google/protobuf/empty.pb-c.c",
    "google/protobuf/struct.pb-c.c",
    "google/protobuf/timestamp.pb-c.c",
    "google/protobuf/wrappers.pb-c.c",
    "google/rpc/status.pb-c.c",
    "google/type/latlng.pb-c.c",
};

fn configureNativeModule(b: *std.Build, mod: *std.Build.Module, optimize: std.builtin.OptimizeMode) void {
    mod.addIncludePath(b.path("proto"));
    mod.addSystemIncludePath(.{ .cwd_relative = "/usr/include" });
    mod.linkSystemLibrary("grpc", .{});
    mod.linkSystemLibrary("protobuf-c", .{});
    mod.link_libc = true;

    const debug_c_flags = [_][]const u8{
        "-I",                   "proto",
        "-I",                   "/usr/include",
        "-fsanitize=undefined", "-fsanitize-trap=undefined",
    };
    const release_c_flags = [_][]const u8{
        "-I", "proto",
        "-I", "/usr/include",
    };
    const flags: []const []const u8 = if (optimize == .Debug)
        &debug_c_flags
    else
        &release_c_flags;

    mod.addCSourceFiles(.{
        .root = b.path("proto"),
        .files = &proto_c_sources,
        .flags = flags,
    });
}

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const exe_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    configureNativeModule(b, exe_mod, optimize);

    const exe = b.addExecutable(.{
        .name = "mocktail",
        .root_module = exe_mod,
    });

    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| run_cmd.addArgs(args);

    const run_step = b.step("run", "Run the mocktail websocket server");
    run_step.dependOn(&run_cmd.step);

    const test_mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });
    configureNativeModule(b, test_mod, optimize);

    const tests = b.addTest(.{ .root_module = test_mod });
    const run_tests = b.addRunArtifact(tests);
    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_tests.step);

    const fmt_check = b.addFmt(.{
        .paths = &.{ "src", "build.zig" },
        .check = true,
    });
    const fmt_step = b.step("fmt", "Check formatting");
    fmt_step.dependOn(&fmt_check.step);
}
