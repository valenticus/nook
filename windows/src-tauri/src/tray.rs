// Native tray labels are supplied by the frontend's shared i18n dictionary.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::island::WINDOW_LABEL;
use crate::visibility;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayMenuLabels {
    pub open_nook: String,
    pub hide_island: String,
    pub show_island: String,
    pub show_agents_list: String,
    pub hide_agents_list: String,
    pub settings: String,
    pub pause: String,
    pub quit: String,
}

impl TrayMenuLabels {
    fn english() -> Self {
        Self {
            open_nook: "Open Nook".into(),
            hide_island: "Hide island".into(),
            show_island: "Show island".into(),
            show_agents_list: "Show agents list".into(),
            hide_agents_list: "Hide agents list".into(),
            settings: "Settings…".into(),
            pause: "Pause".into(),
            quit: "Quit".into(),
        }
    }

    fn validate(&self) -> Result<(), String> {
        let values = [
            &self.open_nook,
            &self.hide_island,
            &self.show_island,
            &self.show_agents_list,
            &self.hide_agents_list,
            &self.settings,
            &self.pause,
            &self.quit,
        ];
        if values.iter().any(|value| {
            value.trim().is_empty()
                || value.chars().count() > 80
                || value.chars().any(char::is_control)
        }) {
            return Err("Invalid tray labels".into());
        }
        Ok(())
    }
}

struct Items {
    open: MenuItem<Wry>,
    hide: MenuItem<Wry>,
    agents: MenuItem<Wry>,
    settings: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    labels: TrayMenuLabels,
    island_hidden: bool,
    agents_shown: bool,
}

#[derive(Default)]
pub struct TrayMenu(Mutex<Option<Items>>);

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let labels = TrayMenuLabels::english();
    let agents_enabled = app
        .try_state::<crate::Shared>()
        .is_some_and(|shared| shared.settings.lock().unwrap().show_agents_list);
    let open = MenuItem::with_id(app, "open", &labels.open_nook, true, None::<&str>)?;
    let hide = MenuItem::with_id(
        app,
        "hide",
        visibility::label(false, &labels.hide_island, &labels.show_island),
        true,
        None::<&str>,
    )?;
    let agents = MenuItem::with_id(
        app,
        "agents",
        crate::agents::label(false, &labels.show_agents_list, &labels.hide_agents_list),
        agents_enabled,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, "settings", &labels.settings, true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", &labels.pause, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", &labels.quit, true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &open, &hide, &agents, &sep1, &settings, &pause, &sep2, &quit,
        ],
    )?;

    app.manage(TrayMenu(Mutex::new(Some(Items {
        open,
        hide,
        agents,
        settings,
        pause,
        quit,
        labels,
        island_hidden: false,
        agents_shown: false,
    }))));

    let mut builder = TrayIconBuilder::with_id("nook")
        .tooltip("Nook")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            "hide" => visibility::toggle(app),
            "agents" => crate::agents::toggle(app),
            id => {
                if id == "open" {
                    visibility::open(app);
                }
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub fn set_labels(app: &AppHandle, labels: TrayMenuLabels) -> Result<(), String> {
    labels.validate()?;
    let state = app
        .try_state::<TrayMenu>()
        .ok_or_else(|| "Tray menu is unavailable".to_string())?;
    let mut state = state.0.lock().unwrap_or_else(|error| error.into_inner());
    let items = state
        .as_mut()
        .ok_or_else(|| "Tray menu is unavailable".to_string())?;
    items
        .open
        .set_text(&labels.open_nook)
        .map_err(|error| error.to_string())?;
    items
        .hide
        .set_text(visibility::label(
            items.island_hidden,
            &labels.hide_island,
            &labels.show_island,
        ))
        .map_err(|error| error.to_string())?;
    items
        .agents
        .set_text(crate::agents::label(
            items.agents_shown,
            &labels.show_agents_list,
            &labels.hide_agents_list,
        ))
        .map_err(|error| error.to_string())?;
    items
        .settings
        .set_text(&labels.settings)
        .map_err(|error| error.to_string())?;
    items
        .pause
        .set_text(&labels.pause)
        .map_err(|error| error.to_string())?;
    items
        .quit
        .set_text(&labels.quit)
        .map_err(|error| error.to_string())?;
    items.labels = labels;
    Ok(())
}

/// The item says what pressing it does next.
pub fn say_hidden(app: &AppHandle, hidden: bool) {
    if let Some(state) = app.try_state::<TrayMenu>() {
        let mut state = state.0.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(items) = state.as_mut() {
            items.island_hidden = hidden;
            let text =
                visibility::label(hidden, &items.labels.hide_island, &items.labels.show_island);
            let _ = items.hide.set_text(text);
        }
    }
}

/// The item says what pressing it does next, and is disabled while the list is off.
pub fn say_agents(app: &AppHandle, enabled: bool, shown: bool) {
    if let Some(state) = app.try_state::<TrayMenu>() {
        let mut state = state.0.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(items) = state.as_mut() {
            items.agents_shown = shown;
            let text = crate::agents::label(
                shown,
                &items.labels.show_agents_list,
                &items.labels.hide_agents_list,
            );
            let _ = items.agents.set_text(text);
            let _ = items.agents.set_enabled(enabled);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_labels_deserialize_camel_case_and_validate() {
        let labels: TrayMenuLabels = serde_json::from_str(r#"{"openNook":"Відкрити Nook","hideIsland":"Приховати","showIsland":"Показати","showAgentsList":"Показати агентів","hideAgentsList":"Приховати агентів","settings":"Налаштування","pause":"Призупинити","quit":"Вийти"}"#).unwrap();
        assert_eq!(labels.open_nook, "Відкрити Nook");
        assert!(labels.validate().is_ok());
    }

    #[test]
    fn invalid_tray_labels_are_rejected() {
        let mut labels = TrayMenuLabels::english();
        labels.quit.clear();
        assert!(labels.validate().is_err());
        labels = TrayMenuLabels::english();
        labels.quit.push('\n');
        assert!(labels.validate().is_err());
        labels = TrayMenuLabels::english();
        labels.quit = "x".repeat(81);
        assert!(labels.validate().is_err());
    }
}
