# spklib source provenance

Vendored from https://github.com/JamesQiu2005/SpektraLab_library,
commit `afafee63ba8be068271eb18a88a020c2a41d206b` (0.3.1, ABI 1, schema 3).
MIT license is preserved in LICENSE; nlohmann/json retains its license header.

Local portability changes: CMake build, Windows system SQLite, UTF-8 process
manifest, portable timestamps/existence checks, and forward-slash paths for
the SDK's path comparisons. The application bundles the helper executable;
it has no dependency on this checkout's absolute location.
