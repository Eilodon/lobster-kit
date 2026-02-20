
// Manual Serde Implementation for I256 wrapper
impl Serialize for Q64_96 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        // Serialize as string to preserve precision in JSON
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for Q64_96 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let val = s.parse::<I256>().map_err(serde::de::Error::custom)?;
        Ok(Q64_96(val))
    }
}
