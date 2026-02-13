import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const OURA_API_BASE = 'https://api.ouraring.com/v2/usercollection';

export class OuraApiClient {
    constructor(settings, oauth) {
        this._settings = settings;
        this._oauth = oauth;
        this._session = new Soup.Session();
    }

    // Get today's date in YYYY-MM-DD format
    _getTodayDate() {
        const now = GLib.DateTime.new_now_local();
        return now.format('%Y-%m-%d');
    }

    // Get date N days ago in YYYY-MM-DD format
    _getDateDaysAgo(daysAgo) {
        const now = GLib.DateTime.new_now_local();
        const past = now.add_days(-daysAgo);
        return past.format('%Y-%m-%d');
    }

    // Calculate how many days ago a date string was
    _daysAgo(dateString) {
        const now = GLib.DateTime.new_now_local();
        const [year, month, day] = dateString.split('-').map(Number);
        const scoreDate = GLib.DateTime.new_local(year, month, day, 0, 0, 0);

        const diff = now.difference(scoreDate);
        const days = Math.floor(diff / (1000000 * 60 * 60 * 24)); // Convert microseconds to days

        return days;
    }

    // Make an authenticated API request
    _makeRequest(endpoint, callback) {
        console.log('[O-Ring API] Making request to:', endpoint);
        let accessToken = this._settings.get_string('access-token');

        if (!accessToken) {
            console.error('[O-Ring API] No access token available');
            callback(new Error('Not authenticated'), null);
            return;
        }

        // Check if token needs refresh
        if (this._oauth.isTokenExpired()) {
            console.log('[O-Ring API] Token expired, refreshing...');
            this._oauth.refreshToken((error, tokens) => {
                if (error) {
                    console.error('[O-Ring API] Token refresh failed:', error);
                    callback(error, null);
                    return;
                }
                console.log('[O-Ring API] Token refreshed successfully');
                accessToken = tokens.access_token;
                this._executeRequest(endpoint, accessToken, callback);
            });
        } else {
            console.log('[O-Ring API] Token still valid');
            this._executeRequest(endpoint, accessToken, callback);
        }
    }

    _executeRequest(endpoint, accessToken, callback) {
        console.log('[O-Ring API] Executing request to:', endpoint);

        const message = Soup.Message.new('GET', endpoint);
        message.request_headers.append('Authorization', `Bearer ${accessToken}`);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder();
                    const response = decoder.decode(bytes.get_data());

                    console.log('[O-Ring API] Response status:', message.status_code);

                    if (message.status_code !== 200) {
                        console.error('[O-Ring API] API request failed with status:', message.status_code);
                        callback(new Error(`API request failed: ${message.status_code}`), null);
                        return;
                    }

                    const data = JSON.parse(response);
                    console.log('[O-Ring API] Parsed data successfully');
                    callback(null, data);

                } catch (e) {
                    console.error('[O-Ring API] Error in executeRequest:', e);
                    console.error('[O-Ring API] Stack trace:', e.stack);
                    callback(e, null);
                }
            }
        );
    }

    // Get all scores from the most recent day that has at least one score
    getAllScores(callback) {
        console.log('[O-Ring API] Getting all scores');

        const endDate = this._getTodayDate();
        const startDate = this._getDateDaysAgo(7);

        // Scores indexed by date for each type
        let allData = {
            sleep: {},      // date -> score
            readiness: {},  // date -> score
            activity: {}    // date -> score
        };
        let completed = 0;
        let hasError = false;

        const checkComplete = () => {
            completed++;
            console.log('[O-Ring API] Completed requests:', completed, '/3');

            if (completed === 3) {
                if (hasError) {
                    callback(new Error('Some requests failed'), null);
                    return;
                }

                // Collect all unique dates that have at least one score
                const allDates = new Set([
                    ...Object.keys(allData.sleep),
                    ...Object.keys(allData.readiness),
                    ...Object.keys(allData.activity)
                ]);

                console.log('[O-Ring API] All dates with any data:', Array.from(allDates));

                if (allDates.size === 0) {
                    console.log('[O-Ring API] No data found in the last 7 days');
                    callback(null, {
                        sleep: null,
                        readiness: null,
                        activity: null,
                        maxDaysOld: null,
                        date: null
                    });
                    return;
                }

                // Pick the most recent date
                const sortedDates = Array.from(allDates).sort((a, b) => b.localeCompare(a));
                const mostRecentDate = sortedDates[0];
                const daysOld = this._daysAgo(mostRecentDate);

                console.log('[O-Ring API] Most recent date with data:', mostRecentDate, '(', daysOld, 'days old)');

                // Return scores for that date only, null if not available on that day
                const result = {
                    sleep: allData.sleep[mostRecentDate] || null,
                    readiness: allData.readiness[mostRecentDate] || null,
                    activity: allData.activity[mostRecentDate] || null,
                    maxDaysOld: daysOld,
                    date: mostRecentDate
                };

                console.log('[O-Ring API] Scores for', mostRecentDate, ':', result);
                callback(null, result);
            }
        };

        // Fetch sleep data
        const sleepEndpoint = `${OURA_API_BASE}/daily_sleep?start_date=${startDate}&end_date=${endDate}`;
        this._makeRequest(sleepEndpoint, (error, data) => {
            if (error) {
                console.error('[O-Ring API] Sleep data error:', error);
                hasError = true;
            } else if (data.data) {
                data.data.forEach(item => {
                    if (item.score !== null) {
                        allData.sleep[item.day] = item.score;
                    }
                });
                console.log('[O-Ring API] Sleep scores by date:', allData.sleep);
            }
            checkComplete();
        });

        // Fetch readiness data
        const readinessEndpoint = `${OURA_API_BASE}/daily_readiness?start_date=${startDate}&end_date=${endDate}`;
        this._makeRequest(readinessEndpoint, (error, data) => {
            if (error) {
                console.error('[O-Ring API] Readiness data error:', error);
                hasError = true;
            } else if (data.data) {
                data.data.forEach(item => {
                    if (item.score !== null) {
                        allData.readiness[item.day] = item.score;
                    }
                });
                console.log('[O-Ring API] Readiness scores by date:', allData.readiness);
            }
            checkComplete();
        });

        // Fetch activity data
        const activityEndpoint = `${OURA_API_BASE}/daily_activity?start_date=${startDate}&end_date=${endDate}`;
        this._makeRequest(activityEndpoint, (error, data) => {
            if (error) {
                console.error('[O-Ring API] Activity data error:', error);
                hasError = true;
            } else if (data.data) {
                data.data.forEach(item => {
                    if (item.score !== null) {
                        allData.activity[item.day] = item.score;
                    }
                });
                console.log('[O-Ring API] Activity scores by date:', allData.activity);
            }
            checkComplete();
        });
    }
}