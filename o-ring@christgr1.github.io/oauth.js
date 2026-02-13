import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';

const OURA_AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize';
const OURA_TOKEN_URL = 'https://api.ouraring.com/oauth/token';
const REDIRECT_URI = 'http://localhost:8080/callback';

export class OuraOAuth {
    constructor(settings) {
        this._settings = settings;
        this._session = new Soup.Session();
        this._httpServer = null;
        this._authCallback = null;
    }

    // Generate a random state for CSRF protection
    _generateState() {
        return GLib.uuid_string_random();
    }

    // Start the OAuth flow
    startAuthFlow(callback) {
        this._authCallback = callback;
        const clientId = this._settings.get_string('client-id');
        
        if (!clientId) {
            callback(new Error('Client ID not configured'), null);
            return;
        }

        const state = this._generateState();
        
        // Start local HTTP server to receive callback
        this._startCallbackServer(state);
        
        // Build authorization URL
        const authUrl = `${OURA_AUTH_URL}?` +
            `response_type=code&` +
            `client_id=${encodeURIComponent(clientId)}&` +
            `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
            `state=${encodeURIComponent(state)}&` +
            `scope=daily`;
        
        // Open browser for user to authorize
        Gio.AppInfo.launch_default_for_uri(authUrl, null);
    }

    // Start a simple HTTP server to receive the OAuth callback
    _startCallbackServer(expectedState) {
        try {
            const service = new Gio.SocketService();
            const address = new Gio.InetSocketAddress({
                address: Gio.InetAddress.new_from_string('127.0.0.1'),
                port: 8080
            });
            
            service.add_address(
                address,
                Gio.SocketType.STREAM,
                Gio.SocketProtocol.TCP,
                null
            );

            service.connect('incoming', (service, connection) => {
                this._handleCallback(connection, expectedState);
                service.stop();
                return true;
            });

            service.start();
            this._httpServer = service;
            console.log('[O-Ring OAuth] Callback server started on port 8080');
            
        } catch (e) {
            console.error('[O-Ring OAuth] Failed to start callback server:', e);
            if (this._authCallback) {
                this._authCallback(e, null);
            }
        }
    }

    // Handle the OAuth callback
    _handleCallback(connection, expectedState) {
        console.log('[O-Ring OAuth] Handling OAuth callback');
        const input = connection.get_input_stream();
        const dis = new Gio.DataInputStream({ base_stream: input });
        
        try {
            const [line] = dis.read_line_utf8(null);
            console.log('[O-Ring OAuth] Received line:', line);
            
            const match = line.match(/GET \/callback\?(.+) HTTP/);
            
            if (!match) {
                console.error('[O-Ring OAuth] Bad request - no match found');
                this._sendResponse(connection, 400, 'Bad Request');
                return;
            }

            // Parse query parameters manually (URLSearchParams not available in GJS)
            const params = this._parseQueryString(match[1]);
            
            const code = params.code;
            const state = params.state;
            const error = params.error;
            
            console.log('[O-Ring OAuth] Params - code:', code ? 'present' : 'missing',
                        'state:', state, 'error:', error);

            if (error) {
                this._sendResponse(connection, 400, `Authorization failed: ${error}`);
                if (this._authCallback) {
                    this._authCallback(new Error(error), null);
                }
                return;
            }

            if (state !== expectedState) {
                console.error('[O-Ring OAuth] State mismatch. Expected:', expectedState, 'Got:', state);
                this._sendResponse(connection, 400, 'Invalid state parameter');
                if (this._authCallback) {
                    this._authCallback(new Error('State mismatch'), null);
                }
                return;
            }

            if (!code) {
                this._sendResponse(connection, 400, 'No authorization code received');
                if (this._authCallback) {
                    this._authCallback(new Error('No code'), null);
                }
                return;
            }

            // Exchange code for tokens
            this._exchangeCodeForToken(code, (error, tokens) => {
                if (error) {
                    console.error('[O-Ring OAuth] Token exchange failed:', error);
                    this._sendResponse(connection, 500, 'Token exchange failed');
                    if (this._authCallback) {
                        this._authCallback(error, null);
                    }
                } else {
                    console.log('[O-Ring OAuth] Token exchange successful');
                    this._sendResponse(connection, 200, 'Authorization successful! You can close this window.');
                    if (this._authCallback) {
                        this._authCallback(null, tokens);
                    }
                }
            });

        } catch (e) {
            console.error('[O-Ring OAuth] Error handling callback:', e);
            console.error('[O-Ring OAuth] Stack trace:', e.stack);
            this._sendResponse(connection, 500, 'Internal Server Error');
        }
    }

    // Parse query string parameters manually (URLSearchParams not available in GJS)
    _parseQueryString(queryString) {
        const params = {};
        const pairs = queryString.split('&');
        
        for (let pair of pairs) {
            const [key, value] = pair.split('=');
            if (key) {
                params[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
            }
        }
        
        return params;
    }

    _sendResponse(connection, statusCode, message) {
        const output = connection.get_output_stream();
        const statusText = statusCode === 200 ? 'OK' : 'Error';
        
        const response = `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
            `Content-Type: text/html\r\n` +
            `Connection: close\r\n\r\n` +
            `<!DOCTYPE html><html><body><h1>${message}</h1></body></html>`;
        
        output.write(response, null);
        output.close(null);
    }

    // Exchange authorization code for access token
    _exchangeCodeForToken(code, callback) {
        console.log('[O-Ring OAuth] Exchanging code for token');
        const clientId = this._settings.get_string('client-id');
        const clientSecret = this._settings.get_string('client-secret');
        
        console.log('[O-Ring OAuth] Client ID:', clientId ? 'present' : 'missing');
        console.log('[O-Ring OAuth] Client Secret:', clientSecret ? 'present' : 'missing');
        
        const formData = new GLib.Bytes(
            `grant_type=authorization_code&` +
            `code=${encodeURIComponent(code)}&` +
            `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
            `client_id=${encodeURIComponent(clientId)}&` +
            `client_secret=${encodeURIComponent(clientSecret)}`
        );

        const message = Soup.Message.new('POST', OURA_TOKEN_URL);
        message.request_headers.append('Content-Type', 'application/x-www-form-urlencoded');
        message.set_request_body_from_bytes('application/x-www-form-urlencoded', formData);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder();
                    const response = decoder.decode(bytes.get_data());
                    
                    console.log('[O-Ring OAuth] Token response status:', message.status_code);
                    console.log('[O-Ring OAuth] Token response:', response);
                    
                    if (message.status_code !== 200) {
                        callback(new Error(`Token request failed: ${message.status_code}`), null);
                        return;
                    }

                    const tokens = JSON.parse(response);
                    
                    // Save tokens to settings
                    this._settings.set_string('access-token', tokens.access_token);
                    this._settings.set_string('refresh-token', tokens.refresh_token);
                    
                    const expiryTime = GLib.get_real_time() / 1000000 + tokens.expires_in;
                    this._settings.set_int64('token-expiry', expiryTime);
                    
                    callback(null, tokens);
                    
                } catch (e) {
                    console.error('[O-Ring OAuth] Token exchange error:', e);
                    console.error('[O-Ring OAuth] Stack trace:', e.stack);
                    callback(e, null);
                }
            }
        );
    }

    // Refresh the access token
    refreshToken(callback) {
        console.log('[O-Ring OAuth] Refreshing token');
        const clientId = this._settings.get_string('client-id');
        const clientSecret = this._settings.get_string('client-secret');
        const refreshToken = this._settings.get_string('refresh-token');
        
        if (!refreshToken) {
            callback(new Error('No refresh token available'), null);
            return;
        }

        const formData = new GLib.Bytes(
            `grant_type=refresh_token&` +
            `refresh_token=${encodeURIComponent(refreshToken)}&` +
            `client_id=${encodeURIComponent(clientId)}&` +
            `client_secret=${encodeURIComponent(clientSecret)}`
        );

        const message = Soup.Message.new('POST', OURA_TOKEN_URL);
        message.request_headers.append('Content-Type', 'application/x-www-form-urlencoded');
        message.set_request_body_from_bytes('application/x-www-form-urlencoded', formData);

        this._session.send_and_read_async(
            message,
            GLib.PRIORITY_DEFAULT,
            null,
            (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    const decoder = new TextDecoder();
                    const response = decoder.decode(bytes.get_data());
                    
                    console.log('[O-Ring OAuth] Refresh response status:', message.status_code);
                    
                    if (message.status_code !== 200) {
                        callback(new Error(`Token refresh failed: ${message.status_code}`), null);
                        return;
                    }

                    const tokens = JSON.parse(response);
                    
                    this._settings.set_string('access-token', tokens.access_token);
                    this._settings.set_string('refresh-token', tokens.refresh_token);
                    
                    const expiryTime = GLib.get_real_time() / 1000000 + tokens.expires_in;
                    this._settings.set_int64('token-expiry', expiryTime);
                    
                    callback(null, tokens);
                    
                } catch (e) {
                    console.error('[O-Ring OAuth] Token refresh error:', e);
                    console.error('[O-Ring OAuth] Stack trace:', e.stack);
                    callback(e, null);
                }
            }
        );
    }

    // Check if token is expired or about to expire (within 5 minutes)
    isTokenExpired() {
        const expiry = this._settings.get_int64('token-expiry');
        const now = GLib.get_real_time() / 1000000;
        return now >= (expiry - 300);
    }

    destroy() {
        if (this._httpServer) {
            this._httpServer.stop();
            this._httpServer = null;
        }
        this._authCallback = null;
    }
}