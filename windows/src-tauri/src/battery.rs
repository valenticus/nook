//! Read-only system battery status shared by Nook Dev and Standalone.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevBatteryStatus {
    pub percent: Option<u8>,
    pub ac_connected: Option<bool>,
    pub charging: Option<bool>,
    pub battery_present: Option<bool>,
}

/// Keep the existing command name and payload stable for the frontend bridge.
#[tauri::command]
pub fn dev_battery_status() -> DevBatteryStatus {
    #[cfg(windows)]
    {
        use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
        let mut status = SYSTEM_POWER_STATUS::default();
        if unsafe { GetSystemPowerStatus(&mut status) }.is_ok() {
            let no_battery = status.BatteryFlag & 128 != 0;
            let battery_present = if status.BatteryFlag == 255 {
                None
            } else {
                Some(!no_battery)
            };
            return DevBatteryStatus {
                percent: if battery_present != Some(true) || status.BatteryLifePercent == 255 {
                    None
                } else {
                    Some(status.BatteryLifePercent.min(100))
                },
                ac_connected: match status.ACLineStatus {
                    0 => Some(false),
                    1 => Some(true),
                    _ => None,
                },
                charging: if battery_present != Some(true) {
                    None
                } else {
                    Some(status.BatteryFlag & 8 != 0)
                },
                battery_present,
            };
        }
    }
    DevBatteryStatus {
        percent: None,
        ac_connected: None,
        charging: None,
        battery_present: None,
    }
}

#[cfg(test)]
mod tests {
    use super::DevBatteryStatus;

    #[test]
    fn battery_payload_keeps_existing_fields_and_does_not_claim_an_eta() {
        let value = serde_json::to_value(DevBatteryStatus {
            percent: Some(73),
            ac_connected: Some(true),
            charging: Some(true),
            battery_present: Some(true),
        })
        .unwrap();
        assert_eq!(value["percent"], 73);
        assert_eq!(value["acConnected"], true);
        assert_eq!(value["charging"], true);
        assert_eq!(value["batteryPresent"], true);
        assert_eq!(value.as_object().unwrap().len(), 4);
        assert!(value.get("timeToFull").is_none());
    }
}
