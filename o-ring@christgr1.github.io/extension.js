import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { OuraOAuth } from './oauth.js';
import { OuraApiClient } from './ouraApi.js';

export default class ORingExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._oauth = new OuraOAuth(this._settings);
        this._api = new OuraApiClient(this._settings, this._oauth);

        // Create panel button
        this._indicator = new PanelMenu.Button(0.0, 'Oura Scores', false);

        // Create a box to hold icons and score labels
        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });

        // Sleep icon + label
        this._sleepIcon = new St.Icon({
            gicon: this._getIcon('sleep-symbolic'),
            style_class: 'system-status-icon',
        });
        this._sleepLabel = new St.Label({
            text: '--',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Readiness icon + label (still emoji for now)
        this._readinessLabel = new St.Label({
            text: '🌱--',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Activity icon + label (still emoji for now)
        this._activityLabel = new St.Label({
            text: '🔥--',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Add everything to the box
        this._box.add_child(this._sleepIcon);
        this._box.add_child(this._sleepLabel);
        this._box.add_child(this._readinessLabel);
        this._box.add_child(this._activityLabel);

        this._indicator.add_child(this._box);

        // Create popup menu
        this._createMenu();

        // Add to panel
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Start updating scores
        this._updateScores();
        this._startTimer();
    }

    _createMenu() {
        // Status indicator
        this._statusItem = new PopupMenu.PopupMenuItem('Status: Not Authorized', {
            reactive: false,
            can_focus: false
        });
        this._indicator.menu.addMenuItem(this._statusItem);

        // Date indicator
        this._dateItem = new PopupMenu.PopupMenuItem('Last updated: --', {
            reactive: false,
            can_focus: false
        });
        this._indicator.menu.addMenuItem(this._dateItem);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh button
        this._refreshItem = new PopupMenu.PopupMenuItem('Refresh Scores');
        this._refreshItem.connect('activate', () => {
            this._updateScores();
        });
        this._indicator.menu.addMenuItem(this._refreshItem);

        // Authorize button (only visible when not authenticated)
        this._authItem = new PopupMenu.PopupMenuItem('Authorize Oura');
        this._authItem.connect('activate', () => {
            this._startAuthorization();
        });
        this._indicator.menu.addMenuItem(this._authItem);

        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Settings button
        const settingsItem = new PopupMenu.PopupMenuItem('Settings');
        settingsItem.connect('activate', () => {
            this.openPreferences();
        });
        this._indicator.menu.addMenuItem(settingsItem);

        this._updateAuthButton();
    }

    _updateAuthButton() {
        const hasToken = this._settings.get_string('access-token') !== '';

        // Show/hide authorize button
        if (this._authItem) {
            this._authItem.visible = !hasToken;
        }

        // Enable/disable refresh button
        if (this._refreshItem) {
            this._refreshItem.setSensitive(hasToken);
        }

        // Update status text
        if (this._statusItem) {
            if (hasToken) {
                this._statusItem.label.text = 'Status: Authorized ✓';
            } else {
                this._statusItem.label.text = 'Status: Not Authorized';
            }
        }
    }

    _startAuthorization() {
        console.log('[O-Ring] Starting authorization flow');
        this._oauth.startAuthFlow((error, tokens) => {
            if (error) {
                console.error('[O-Ring] Authorization failed:', error);
                Main.notify('Oura Scores', 'Authorization failed. Check logs for details.');
            } else {
                console.log('[O-Ring] Authorization successful');
                Main.notify('Oura Scores', 'Authorization successful!');
                this._updateAuthButton();
                this._updateScores();
            }
        });
    }

    _updateScores() {
        console.log('[O-Ring] Update scores called');
        const hasToken = this._settings.get_string('access-token') !== '';

        if (!hasToken) {
            console.log('[O-Ring] No token available');
            this._sleepLabel.set_text('-- ');
            this._readinessLabel.set_text('🌱-- ');
            this._activityLabel.set_text('🔥--');
            Main.notify(
                'Oura Scores',
                'Please authorize Oura first. Click the extension icon and select "Authorize Oura".'
            );
            return;
        }

        console.log('[O-Ring] Token available, fetching scores...');
        this._sleepLabel.set_text('... ');
        this._readinessLabel.set_text('🌱... ');
        this._activityLabel.set_text('🔥...');

        this._api.getAllScores((error, scores) => {
            console.log('[O-Ring] getAllScores callback called');

            if (error) {
                console.error('[O-Ring] Failed to fetch scores:', error);
                console.error('[O-Ring] Error stack:', error.stack);
                this._sleepLabel.set_text('?? ');
                this._readinessLabel.set_text('🌱?? ');
                this._activityLabel.set_text('🔥??');

                if (error.message && error.message.includes('401')) {
                    Main.notify(
                        'Oura Scores',
                        'Authentication expired. Please re-authorize Oura.'
                    );
                } else {
                    Main.notify(
                        'Oura Scores',
                        'Failed to fetch scores. Check your internet connection.'
                    );
                }
                return;
            }

            console.log('[O-Ring] Scores received:', scores);

            // No data found at all in the last 7 days
            if (scores.date === null) {
                this._sleepLabel.set_text('-- ');
                this._readinessLabel.set_text('🌱-- ');
                this._activityLabel.set_text('🔥--');
                Main.notify(
                    'Oura Scores',
                    'No data found in the last 7 days.'
                );
                if (this._dateItem) {
                    this._dateItem.label.text = 'Last updated: No data';
                }
                return;
            }

            const sleepText = scores.sleep !== null ? scores.sleep : '--';
            const readinessText = scores.readiness !== null ? scores.readiness : '--';
            const activityText = scores.activity !== null ? scores.activity : '--';

            // Add warning indicator if scores are not from today
            let ageIndicator = '';
            if (scores.maxDaysOld === 1) {
                ageIndicator = ' ⚠';
            } else if (scores.maxDaysOld > 1) {
                ageIndicator = ' ⚠⚠';
            }

            this._sleepLabel.set_text(`${sleepText} `);
            this._readinessLabel.set_text(`🌱${readinessText} `);
            this._activityLabel.set_text(`🔥${activityText}${ageIndicator}`);

            // Update date item in menu
            if (this._dateItem) {
                if (scores.maxDaysOld === 0) {
                    this._dateItem.label.text = 'Last updated: Today';
                } else if (scores.maxDaysOld === 1) {
                    this._dateItem.label.text = 'Last updated: Yesterday';
                } else {
                    this._dateItem.label.text = `Last updated: ${scores.maxDaysOld} days ago`;
                }
            }

            // Notify if data is outdated
            if (scores.maxDaysOld === 1) {
                Main.notify(
                    'Oura Scores',
                    'Showing yesterday\'s scores (today\'s data not yet available).'
                );
            } else if (scores.maxDaysOld > 1) {
                Main.notify(
                    'Oura Scores',
                    `Showing scores from ${scores.maxDaysOld} days ago (${scores.date}).`
                );
            }
        });
    }

    _startTimer() {
        const interval = this._settings.get_int('update-interval');

        this._timeout = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._updateScores();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _getIcon(name) {
        return Gio.icon_new_for_string(`${this.path}/icons/${name}.svg`);
    }

    disable() {
        if (this._timeout) {
            GLib.Source.remove(this._timeout);
            this._timeout = null;
        }

        if (this._oauth) {
            this._oauth.destroy();
            this._oauth = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._api = null;
        this._settings = null;
        this._box = null;
        this._sleepIcon = null;
        this._sleepLabel = null;
        this._readinessLabel = null;
        this._activityLabel = null;
        this._refreshItem = null;
        this._authItem = null;
        this._statusItem = null;
        this._dateItem = null;
    }
}