fn main() {
    // the Node-API build links against the host's symbols (src/node.rs)
    if std::env::var_os("CARGO_FEATURE_NODE").is_some() {
        napi_build::setup();
    }
}
