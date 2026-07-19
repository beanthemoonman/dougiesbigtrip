pub mod protocol;

#[cfg(feature = "wasm")]
mod wasm_api {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    pub fn sim_greet() -> String {
        "sim.wasm loaded".into()
    }

    #[wasm_bindgen]
    pub fn protocol_version() -> u8 {
        super::protocol::PROTOCOL_VERSION
    }
}
