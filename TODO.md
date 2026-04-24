# Proton Drive Linux — Implementation Milestones

## Milestone 1 — SDK Adapter (interfaces + mock)
- [ ] `daemon/src/sdk/mod.rs`     — `IProtonDriveSDK` trait + all shared types
- [ ] `daemon/src/sdk/mock.rs`    — `MockProtonDriveSDK` (in-memory, injectable errors)
- [ ] `daemon/src/sdk/error.rs`   — `SdkError` enum with circuit-breaker awareness

## Milestone 2 — Auth Module
- [ ] `daemon/src/auth/mod.rs`    — public API + `AuthManager` struct
- [ ] `daemon/src/auth/srp.rs`    — SRP two-round-trip against Proton `/auth/info` + `/auth`
- [ ] `daemon/src/auth/session.rs`— session token storage, refresh, expiry detection
- [ ] `daemon/src/auth/keyring.rs`— libsecret (D-Bus Secret Service) read/write

## Milestone 3 — FUSE Layer (backed by MockSdk)
- [ ] `daemon/src/fuse/mod.rs`
- [ ] `daemon/src/fuse/filesystem.rs` — `fuser::Filesystem` impl (all required ops)
- [ ] `daemon/src/fuse/cache.rs`       — metadata + attr cache (TTL, LRU)
- [ ] `daemon/src/fuse/block_cache.rs` — disk block cache (LRU eviction)
- [ ] `daemon/src/fuse/handles.rs`     — open-file handle table
- [ ] `daemon/src/main.rs`             — full daemon entry point + systemd sd_notify

## Milestone 4 — Sync Engine
- [ ] `daemon/src/sync/engine.rs`   — main sync loop
- [ ] `daemon/src/sync/queue.rs`    — SQLite-backed upload queue
- [ ] `daemon/src/sync/conflict.rs` — conflict detection + renamed-copy strategy
- [ ] `daemon/src/sync/events.rs`   — SDK event subscription + cache invalidation

## Milestone 5 — IPC (D-Bus + UDS event socket)
- [ ] `daemon/src/ipc/dbus_server.rs`  — `org.protondrive.Daemon` interface
- [ ] `daemon/src/ipc/event_socket.rs` — Unix Domain Socket event stream

## Milestone 6 — Live SDK Adapter
- [ ] `sdk-bindings/proto/`                — copy .proto files from tuuuni0scouts/sdk
- [ ] `sdk-bindings/src/client.rs`         — safe async wrapper over FFI + Protobuf
- [ ] `daemon/src/sdk/adapter.rs`          — `LiveProtonDriveSDK` using sdk-bindings
- [ ] `daemon/src/sdk/circuit_breaker.rs`  — CB state machine wrapping the adapter

## Milestone 7 — Python GUI
- [ ] `gui/proton_drive_gui/app.py`
- [ ] `gui/proton_drive_gui/tray.py`
- [ ] `gui/proton_drive_gui/daemon_client.py`
- [ ] `gui/proton_drive_gui/windows/status_window.py`
- [ ] `gui/proton_drive_gui/windows/settings_window.py`

## Milestone 8 — Debian Packaging
- [ ] `packaging/debian/control`
- [ ] `packaging/debian/rules`
- [ ] `packaging/debian/proton-drive.service`
- [ ] `packaging/debian/postinst`
