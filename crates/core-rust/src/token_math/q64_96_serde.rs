// Manual Serde Implementation for I256 wrapper
impl Serialize for Q64_96 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bytes(&self.0.to_be_bytes())
    }
}

impl<'de> Deserialize<'de> for Q64_96 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Q64_96SerdeInput {
            Bytes(Vec<u8>),
            DecimalString(String),
        }

        match Q64_96SerdeInput::deserialize(deserializer)? {
            Q64_96SerdeInput::Bytes(bytes) => {
                if bytes.len() > 32 {
                    return Err(serde::de::Error::custom("Q64.96 expects <= 32 bytes"));
                }

                let mut full = [0u8; 32];
                if bytes.is_empty() {
                    return Ok(Q64_96(I256::ZERO));
                }

                // Sign-extend shorter payloads to preserve signed I256 semantics.
                let sign_pad = if (bytes[0] & 0x80) != 0 { 0xFF } else { 0x00 };
                full.fill(sign_pad);
                let start = 32 - bytes.len();
                full[start..].copy_from_slice(&bytes);

                Ok(Q64_96(I256::from_be_bytes(full)))
            }
            Q64_96SerdeInput::DecimalString(s) => {
                let val = s.parse::<I256>().map_err(serde::de::Error::custom)?;
                Ok(Q64_96(val))
            }
        }
    }
}
