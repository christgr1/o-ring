import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ORingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Create a preferences page
        const page = new Adw.PreferencesPage();
        window.add(page);

        // Create a group for Oauth settings
        const oauthGroup = new Adw.PreferencesGroup({
            title: 'OAuth Configuration',
            description: 'Configure your Oura API Ccedentials'
        });
        page.add(oauthGroup);

        // Client ID
        const clientIdRow = new Adw.EntryRow({
            title: 'Client ID',
            text: settings.get_string('client-id'),
        });
        settings.bind('client-id', clientIdRow, 'text', Gio.SettingsBindFlags.DEFAULT); // two-way setting sync
        oauthGroup.add(clientIdRow);

        // Client Secret
        const clientSecretRow = new Adw.PasswordEntryRow({
            title: 'Client Secret',
            text: settings.get_string('client-secret'),
        });
        settings.bind('client-secret', clientSecretRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        oauthGroup.add(clientSecretRow);

        // General Settings Group
        const generalGroup = new Adw.PreferencesGroup({
            title: 'General Settings',
            description: 'Configure general settings for the extension'
        });
        page.add(generalGroup);

        // Update Interval
        const updateIntervalRow = new Adw.SpinRow({
            title: 'Update Interval',
            subtitle: 'How often the extension should fetch new data from the Oura API (in seconds)',
            adjustment: new Gtk.Adjustment({
                lower: 60, // Minimum 1 minute
                upper: 86400, // Maximum 24 hours
                step_increment: 60, // Step by 1 minute
                page_increment: 300, // Page step by 5 minutes
                value: settings.get_int('update-interval'),
            }),
        });
        settings.bind('update-interval', updateIntervalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(updateIntervalRow);
    }
}
