/* ============================================================
 * node-binance-us-api
 * https://github.com/tdeineka/node-binance-us-api
 * ============================================================
 * Copyright 2017-, Jon Eyrick
 * Released under the MIT License
 * ============================================================
 * @module tdeineka/node-binance-us-api
 * @return {object} instance to class object */
let api = function Binance( options = {} ) {
    //'use strict'; // eslint-disable-line no-unused-expressions
    let Binance = this; // eslint-disable-line consistent-this
    
    const WebSocket = require( 'ws' );
    const request = require( 'request' );
    const crypto = require( 'crypto' );
    const file = require( 'fs' );
    const url = require( 'url' );
    const HttpsProxyAgent = require( 'https-proxy-agent' );
    const SocksProxyAgent = require( 'socks-proxy-agent' );
    const stringHash = require( 'string-hash' );
    const async = require( 'async' );
    let base = 'https://api.binance.us/api/';
    let wapi = 'https://api.binance.us/wapi/';
    let sapi = 'https://api.binance.us/sapi/';
    let fapi = 'https://fapi.binance.us/fapi/';
    let stream = 'wss://stream.binance.us:9443/ws/';
    let combineStream = 'wss://stream.binance.us:9443/stream?streams=';
    const userAgent = 'Mozilla/4.0 (compatible; Node Binance.US API)';
    const contentType = 'application/x-www-form-urlencoded';
    Binance.subscriptions = {};
    Binance.depthCache = {};
    Binance.depthCacheContext = {};
    Binance.ohlcLatest = {};
    Binance.klineQueue = {};
    Binance.ohlc = {};
    const default_options = {
        recvWindow: 5000,
        useServerTime: false,
        reconnect: true,
        verbose: false,
        test: false,
        log: function ( ...args ) {
            console.log( Array.prototype.slice.call( args ) );
        }
    };
    Binance.options = default_options;
    Binance.info = { timeOffset: 0 };
    Binance.socketHeartbeatInterval = null;
    if ( options ) setOptions( options );

    function setOptions( opt = {}, callback = false ) {
        if ( typeof opt === 'string' ) { // Pass json config filename
            Binance.options = JSON.parse( file.readFileSync( opt ) );
        } else Binance.options = opt;
        if ( typeof Binance.options.recvWindow === 'undefined' ) Binance.options.recvWindow = default_options.recvWindow;
        if ( typeof Binance.options.useServerTime === 'undefined' ) Binance.options.useServerTime = default_options.useServerTime;
        if ( typeof Binance.options.reconnect === 'undefined' ) Binance.options.reconnect = default_options.reconnect;
        if ( typeof Binance.options.test === 'undefined' ) Binance.options.test = default_options.test;
        if ( typeof Binance.options.log === 'undefined' ) Binance.options.log = default_options.log;
        if ( typeof Binance.options.verbose === 'undefined' ) Binance.options.verbose = default_options.verbose;
        if ( typeof Binance.options.urls !== 'undefined' ) {
            const { urls } = Binance.options;
            if( typeof urls.base === 'string' ) base = urls.base;
            if( typeof urls.wapi === 'string' ) wapi = urls.wapi;
            if( typeof urls.sapi === 'string' ) sapi = urls.sapi;
            if( typeof urls.fapi === 'string' ) fapi = urls.fapi;
            if( typeof urls.stream === 'string' ) stream = urls.stream;
            if( typeof urls.combineStream === 'string' ) combineStream = urls.combineStream;
        }
        if ( Binance.options.useServerTime ) {
            apiRequest( base + 'v1/time', {}, function ( error, response ) {
                Binance.info.timeOffset = response.serverTime - new Date().getTime();
                //Binance.options.log("server time set: ", response.serverTime, Binance.info.timeOffset);
                if ( callback ) callback();
            } );
        } else if ( callback ) callback();
        return this;
    }

    /**
     * Replaces socks connection uri hostname with IP address
     * @param {string} connString - socks connection string
     * @return {string} modified string with ip address
     */
    const proxyReplacewithIp = connString => {
        return connString;
    }

    /**
     * Returns an array in the form of [host, port]
     * @param {string} connString - connection string
     * @return {array} array of host and port
     */
    const parseProxy = connString => {
        let arr = connString.split( '/' );
        let host = arr[2].split( ':' )[0];
        let port = arr[2].split( ':' )[1];
        return [arr[0], host, port];
    }

    /**
     * Checks to see of the object is iterable
     * @param {object} obj - The object check
     * @return {boolean} true or false is iterable
     */
    const isIterable = obj => {
        if ( obj === null ) return false;
        return typeof obj[Symbol.iterator] === 'function';
    }

    const addProxy = opt => {
        if ( Binance.options.proxy ) {
            const proxyauth = Binance.options.proxy.auth ? `${Binance.options.proxy.auth.username}:${Binance.options.proxy.auth.password}@` : '';
            opt.proxy = `http://${proxyauth}${Binance.options.proxy.host}:${Binance.options.proxy.port}`;
        }
        return opt;
    }

    const reqHandler = cb => ( error, response, body ) => {
        if ( !cb ) return;
        if ( error ) return cb( error, {} );
        if ( response && response.statusCode !== 200 ) return cb( response, {} );
        return cb( null, JSON.parse( body ) );
    }

    const proxyRequest = ( opt, cb ) => request( addProxy( opt ), reqHandler( cb ) );

    const reqObj = ( url, data = {}, method = 'GET', key ) => ( {
        url: url,
        qs: data,
        method: method,
        timeout: Binance.options.recvWindow,
        headers: {
            'User-Agent': userAgent,
            'Content-type': contentType,
            'X-MBX-APIKEY': key || ''
        }
    } )
    const reqObjPOST = ( url, data = {}, method = 'POST', key ) => ( {
        url: url,
        form: data,
        method: method,
        timeout: Binance.options.recvWindow,
        headers: {
            'User-Agent': userAgent,
            'Content-type': contentType,
            'X-MBX-APIKEY': key || ''
        }
    } )
    /**
     * Create a http request to the public API
     * @param {string} url - The http endpoint
     * @param {object} data - The data to send
     * @param {function} callback - The callback method to call
     * @param {string} method - the http method
     * @return {undefined}
     */
    const publicRequest = ( url, data = {}, callback, method = 'GET' ) => {
        let opt = reqObj( url, data, method );
        proxyRequest( opt, callback );
    };

    const makeQueryString = q => Object.keys( q ).reduce( ( a,k )=>{ if ( q[k] !== undefined ) { a.push( k+'='+encodeURIComponent( q[k] ) ) } return a }, [] ).join( '&' );

    /**
     * Create a http request to the public API
     * @param {string} url - The http endpoint
     * @param {object} data - The data to send
     * @param {function} callback - The callback method to call
     * @param {string} method - the http method
     * @return {undefined}
     */
    const apiRequest = ( url, data = {}, callback, method = 'GET' ) => {
        if ( !Binance.options.APIKEY ) throw Error( 'apiRequest: Invalid API Key' );
        let opt = reqObj(
            url,
            data,
            method,
            Binance.options.APIKEY
        );
        proxyRequest( opt, callback );
    };

    /**
     * Make market request
     * @param {string} url - The http endpoint
     * @param {object} data - The data to send
     * @param {function} callback - The callback method to call
     * @param {string} method - the http method
     * @return {undefined}
     */
    const marketRequest = ( url, data = {}, callback, method = 'GET' ) => {
        if ( !Binance.options.APIKEY ) throw Error( 'apiRequest: Invalid API Key' );
        let query = makeQueryString( data );
        let opt = reqObj(
            url + ( query ? '?' + query : '' ),
            data,
            method,
            Binance.options.APIKEY
        );
        proxyRequest( opt, callback );
    };

    /**
     * Create a signed http request
     * @param {string} url - The http endpoint
     * @param {object} data - The data to send
     * @param {function} callback - The callback method to call
     * @param {string} method - the http method
     * @param {boolean} noDataInSignature - Prevents data from being added to signature
     * @return {undefined}
     */
    const signedRequest = ( url, data = {}, callback, method = 'GET', noDataInSignature = false ) => {
        if ( !Binance.options.APIKEY ) throw Error( 'apiRequest: Invalid API Key' );
        if ( !Binance.options.APISECRET ) throw Error( 'signedRequest: Invalid API Secret' );
        data.timestamp = new Date().getTime() + Binance.info.timeOffset;
        if ( typeof data.recvWindow === 'undefined' ) data.recvWindow = Binance.options.recvWindow;
        let query = method === 'POST' && noDataInSignature ? '' : makeQueryString( data );
        let signature = crypto.createHmac( 'sha256', Binance.options.APISECRET ).update( query ).digest( 'hex' ); // set the HMAC hash header
        if ( method === 'POST' ) {
            let opt = reqObjPOST(
                url + '?signature=' + signature,
                data,
                method,
                Binance.options.APIKEY
            );
            proxyRequest( opt, callback );
        } else {
            let opt = reqObj(
                url + '?' + query + '&signature=' + signature,
                data,
                method,
                Binance.options.APIKEY
            );
            proxyRequest( opt, callback );
        }
    };

    /**
     * Create a signed http request
     * @param {string} side - BUY or SELL
     * @param {string} symbol - The symbol to buy or sell
     * @param {string} quantity - The quantity to buy or sell
     * @param {string} price - The price per unit to transact each unit at
     * @param {object} flags - additional order settings
     * @param {function} callback - the callback function
     * @return {undefined}
     */
    const order = ( side, symbol, quantity, price, flags = {}, callback = false ) => {
        let endpoint = flags.type === 'OCO' ? 'v3/order/oco' : 'v3/order';
        if ( Binance.options.test ) endpoint += '/test';
        let opt = {
            symbol: symbol,
            side: side,
            type: 'LIMIT',
            quantity: quantity
        };
        if ( typeof flags.type !== 'undefined' ) opt.type = flags.type;
        if ( opt.type.includes( 'LIMIT' ) ) {
            opt.price = price;
            if ( opt.type !== 'LIMIT_MAKER' ) {
                opt.timeInForce = 'GTC';
            }
        }
        if ( opt.type === 'OCO' ) {
            opt.price = price;
            opt.stopLimitPrice = flags.stopLimitPrice;
            opt.stopLimitTimeInForce = 'GTC';
            delete opt.type;
        }
        if ( typeof flags.timeInForce !== 'undefined' ) opt.timeInForce = flags.timeInForce;
        if ( typeof flags.newOrderRespType !== 'undefined' ) opt.newOrderRespType = flags.newOrderRespType;
        if ( typeof flags.newClientOrderId !== 'undefined' ) opt.newClientOrderId = flags.newClientOrderId;

        /*
         * STOP_LOSS
         * STOP_LOSS_LIMIT
         * TAKE_PROFIT
         * TAKE_PROFIT_LIMIT
         * LIMIT_MAKER
         */
        if ( typeof flags.icebergQty !== 'undefined' ) opt.icebergQty = flags.icebergQty;
        if ( typeof flags.stopPrice !== 'undefined' ) {
            opt.stopPrice = flags.stopPrice;
            if ( opt.type === 'LIMIT' ) throw Error( 'stopPrice: Must set "type" to one of the following: STOP_LOSS, STOP_LOSS_LIMIT, TAKE_PROFIT, TAKE_PROFIT_LIMIT' );
        }
        signedRequest( base + endpoint, opt, ( error, response ) => {
            if ( !response ) {
                if ( callback ) callback( error, response );
                else Binance.options.log( 'Order() error:', error );
                return;
            }
            if ( typeof response.msg !== 'undefined' && response.msg === 'Filter failure: MIN_NOTIONAL' ) {
                Binance.options.log( 'Order quantity too small. See exchangeInfo() for minimum amounts' );
            }
            if ( callback ) callback( error, response );
            else Binance.options.log( side + '(' + symbol + ',' + quantity + ',' + price + ') ', response );
        }, 'POST' );
    };

    /**
     * Create a signed http request
     * @param {string} side - BUY or SELL
     * @param {string} symbol - The symbol to buy or sell
     * @param {string} quantity - The quantity to buy or sell
     * @param {string} price - The price per unit to transact each unit at
     * @param {object} flags - additional order settings
     * @param {function} callback - the callback function
     * @return {undefined}
     */
    const marginOrder = ( side, symbol, quantity, price, flags = {}, callback = false ) => {
        let endpoint = 'v1/margin/order';
        if ( Binance.options.test ) endpoint += '/test';
        let opt = {
            symbol: symbol,
            side: side,
            type: 'LIMIT',
            quantity: quantity
        };
        if ( typeof flags.type !== 'undefined' ) opt.type = flags.type;
        if ( opt.type.includes( 'LIMIT' ) ) {
            opt.price = price;
            if ( opt.type !== 'LIMIT_MAKER' ) {
                opt.timeInForce = 'GTC';
            }
        }

        if ( typeof flags.timeInForce !== 'undefined' ) opt.timeInForce = flags.timeInForce;
        if ( typeof flags.newOrderRespType !== 'undefined' ) opt.newOrderRespType = flags.newOrderRespType;
        if ( typeof flags.newClientOrderId !== 'undefined' ) opt.newClientOrderId = flags.newClientOrderId;

        /*
         * STOP_LOSS
         * STOP_LOSS_LIMIT
         * TAKE_PROFIT
         * TAKE_PROFIT_LIMIT
         */
        if ( typeof flags.icebergQty !== 'undefined' ) opt.icebergQty = flags.icebergQty;
        if ( typeof flags.stopPrice !== 'undefined' ) {
            opt.stopPrice = flags.stopPrice;
            if ( opt.type === 'LIMIT' ) throw Error( 'stopPrice: Must set "type" to one of the following: STOP_LOSS, STOP_LOSS_LIMIT, TAKE_PROFIT, TAKE_PROFIT_LIMIT' );
        }
        signedRequest( sapi + endpoint, opt, function ( error, response ) {
            if ( !response ) {
                if ( callback ) callback( error, response );
                else Binance.options.log( 'Order() error:', error );
                return;
            }
            if ( typeof response.msg !== 'undefined' && response.msg === 'Filter failure: MIN_NOTIONAL' ) {
                Binance.options.log( 'Order quantity too small. See exchangeInfo() for minimum amounts' );
            }
            if ( callback ) callback( error, response );
            else Binance.options.log( side + '(' + symbol + ',' + quantity + ',' + price + ') ', response );
        }, 'POST' );
    };

    // Futures internal functions
    const futuresOrder = async ( side, symbol, quantity, price = false, params = {} ) => {
        params.symbol = symbol;
        params.side = side;
        params.quantity = quantity;
        // LIMIT STOP MARKET STOP_MARKET TAKE_PROFIT TAKE_PROFIT_MARKET
        // reduceOnly stopPrice
        if ( price ) {
            params.price = price;
            if ( typeof params.type === 'undefined' ) params.type = 'LIMIT';
        } else {
            if ( typeof params.type === 'undefined' ) params.type = 'MARKET';
        }
        if ( params.type.includes( 'LIMIT' ) || params.type === 'STOP' || params.type === 'TAKE_PROFIT' ) params.timeInForce = 'GTC';
        return promiseRequest( 'v1/order', params, {base:fapi, type:'TRADE', method:'POST'} );
    };
    const promiseRequest = async ( url, data = {}, flags = {} ) => {
        return new Promise( ( resolve, reject ) => {
            let query = '', headers = {
                'User-Agent': userAgent,
                'Content-type': 'application/x-www-form-urlencoded'
            };
            if ( typeof flags.method === 'undefined' ) flags.method = 'GET'; // GET POST PUT DELETE
            if ( typeof flags.type === 'undefined' ) flags.type = false; // TRADE, SIGNED, MARKET_DATA, USER_DATA, USER_STREAM
            else {
                if ( typeof data.recvWindow === 'undefined' ) data.recvWindow = Binance.options.recvWindow;
                headers['X-MBX-APIKEY'] = Binance.options.APIKEY;
                if ( !Binance.options.APIKEY ) return reject( 'Invalid API Key' );
            }
            let baseURL = typeof flags.base === 'undefined' ? base : flags.base;
            let opt = {
                headers,
                url: baseURL + url,
                method: flags.method,
                timeout: Binance.options.recvWindow,
                followAllRedirects: true
            };
            if ( flags.type === 'SIGNED' || flags.type === 'TRADE' || flags.type === 'USER_DATA' ) {
                if ( !Binance.options.APISECRET ) return reject( 'Invalid API Secret' );
                data.timestamp = new Date().getTime() + Binance.info.timeOffset;
                query = makeQueryString( data );
                data.signature = crypto.createHmac( 'sha256', Binance.options.APISECRET ).update( query ).digest( 'hex' ); // HMAC hash header
                opt.url = `${baseURL}${url}?${query}&signature=${data.signature}`;
            }
            opt.qs = data;
            /*if ( flags.method === 'POST' ) {
                opt.form = data;
            } else {
                opt.qs = data;
            }*/
            try {
                request( addProxy( opt ), ( error, response, body ) => {
                    if ( error ) return reject( error );
                    try {
                        if ( !error && response.statusCode == 200 ) return resolve( JSON.parse( body ) );
                        if ( typeof response.body !== 'undefined' ) {
                            return resolve( JSON.parse( response.body ) );
                        }
                        return reject( response );
                    } catch ( err ) {
                        return reject( `promiseRequest error #${response.statusCode}` );
                    }
                } );
            } catch ( err ) {
                return reject( err );
            }
        } );
    };

    /**
     * No-operation function
     * @return {undefined}
     */
    const noop = () => {
        // Do nothing
    };

    /**
     * Reworked Tuitio's heartbeat code into a shared single interval tick
     * @return {undefined}
     */
    const socketHeartbeat = () => {
        /* Sockets removed from `subscriptions` during a manual terminate()
         will no longer be at risk of having functions called on them */
        for ( let endpointId in Binance.subscriptions ) {
            const ws = Binance.subscriptions[endpointId];
            if ( ws.isAlive ) {
                ws.isAlive = false;
                if ( ws.readyState === WebSocket.OPEN ) ws.ping( noop );
            } else {
                if ( Binance.options.verbose ) Binance.options.log( 'Terminating inactive/broken WebSocket: ' + ws.endpoint );
                if ( ws.readyState === WebSocket.OPEN ) ws.terminate();
            }
        }
    };

    /**
     * Called when socket is opened, subscriptions are registered for later reference
     * @param {function} opened_callback - a callback function
     * @return {undefined}
     */
    const handleSocketOpen = function ( opened_callback ) {
        this.isAlive = true;
        if ( Object.keys( Binance.subscriptions ).length === 0 ) {
            Binance.socketHeartbeatInterval = setInterval( socketHeartbeat, 30000 );
        }
        Binance.subscriptions[this.endpoint] = this;
        if ( typeof opened_callback === 'function' ) opened_callback( this.endpoint );
    };

    /**
     * Called when socket is closed, subscriptions are de-registered for later reference
     * @param {boolean} reconnect - true or false to reconnect the socket
     * @param {string} code - code associated with the socket
     * @param {string} reason - string with the response
     * @return {undefined}
     */
    const handleSocketClose = function ( reconnect, code, reason ) {
        delete Binance.subscriptions[this.endpoint];
        if ( Binance.subscriptions && Object.keys( Binance.subscriptions ).length === 0 ) {
            clearInterval( Binance.socketHeartbeatInterval );
        }
        Binance.options.log( 'WebSocket closed: ' + this.endpoint +
          ( code ? ' (' + code + ')' : '' ) +
          ( reason ? ' ' + reason : '' ) );
        if ( Binance.options.reconnect && this.reconnect && reconnect ) {
            if ( this.endpoint && parseInt( this.endpoint.length, 10 ) === 60 ) Binance.options.log( 'Account data WebSocket reconnecting...' );
            else Binance.options.log( 'WebSocket reconnecting: ' + this.endpoint + '...' );
            try {
                reconnect();
            } catch ( error ) {
                Binance.options.log( 'WebSocket reconnect error: ' + error.message );
            }
        }
    };

    /**
     * Called when socket errors
     * @param {object} error - error object message
     * @return {undefined}
     */
    const handleSocketError = function ( error ) {
        /* Errors ultimately result in a `close` event.
         see: https://github.com/websockets/ws/blob/828194044bf247af852b31c49e2800d557fedeff/lib/websocket.js#L126 */
        Binance.options.log( 'WebSocket error: ' + this.endpoint +
          ( error.code ? ' (' + error.code + ')' : '' ) +
          ( error.message ? ' ' + error.message : '' ) );
    };

    /**
     * Called on each socket heartbeat
     * @return {undefined}
     */
    const handleSocketHeartbeat = function () {
        this.isAlive = true;
    };

    /**
     * Used to subscribe to a single websocket endpoint
     * @param {string} endpoint - endpoint to connect to
     * @param {function} callback - the function to call when information is received
     * @param {boolean} reconnect - whether to reconnect on disconnect
     * @param {object} opened_callback - the function to call when opened
     * @return {WebSocket} - websocket reference
     */
    const subscribe = function ( endpoint, callback, reconnect = false, opened_callback = false ) {
        let httpsproxy = process.env.https_proxy || false;
        let socksproxy = process.env.socks_proxy || false;
        let ws = false;

        if ( socksproxy !== false ) {
            socksproxy = proxyReplacewithIp( socksproxy );
            if ( Binance.options.verbose ) Binance.options.log( 'using socks proxy server ' + socksproxy );
            let agent = new SocksProxyAgent( {
                protocol: parseProxy( socksproxy )[0],
                host: parseProxy( socksproxy )[1],
                port: parseProxy( socksproxy )[2]
            } );
            ws = new WebSocket( stream + endpoint, { agent: agent } );
        } else if ( httpsproxy !== false ) {
            if ( Binance.options.verbose ) Binance.options.log( 'using proxy server ' + agent );
            let config = url.parse( httpsproxy );
            let agent = new HttpsProxyAgent( config );
            ws = new WebSocket( stream + endpoint, { agent: agent } );
        } else {
            ws = new WebSocket( stream + endpoint );
        }

        if ( Binance.options.verbose ) Binance.options.log( 'Subscribed to ' + endpoint );
        ws.reconnect = Binance.options.reconnect;
        ws.endpoint = endpoint;
        ws.isAlive = false;
        ws.on( 'open', handleSocketOpen.bind( ws, opened_callback ) );
        ws.on( 'pong', handleSocketHeartbeat );
        ws.on( 'error', handleSocketError );
        ws.on( 'close', handleSocketClose.bind( ws, reconnect ) );
        ws.on( 'message', data => {
            try {
                callback( JSON.parse( data ) );
            } catch ( error ) {
                Binance.options.log( 'Parse error: ' + error.message );
            }
        } );
        return ws;
    };

    /**
     * Used to subscribe to a combined websocket endpoint
     * @param {string} streams - streams to connect to
     * @param {function} callback - the function to call when information is received
     * @param {boolean} reconnect - whether to reconnect on disconnect
     * @param {object} opened_callback - the function to call when opened
     * @return {WebSocket} - websocket reference
     */
    const subscribeCombined = function ( streams, callback, reconnect = false, opened_callback = false ) {
        let httpsproxy = process.env.https_proxy || false;
        let socksproxy = process.env.socks_proxy || false;
        const queryParams = streams.join( '/' );
        let ws = false;
        if ( socksproxy !== false ) {
            socksproxy = proxyReplacewithIp( socksproxy );
            if ( Binance.options.verbose ) Binance.options.log( 'using socks proxy server ' + socksproxy );
            let agent = new SocksProxyAgent( {
                protocol: parseProxy( socksproxy )[0],
                host: parseProxy( socksproxy )[1],
                port: parseProxy( socksproxy )[2]
            } );
            ws = new WebSocket( combineStream + queryParams, { agent: agent } );
        } else if ( httpsproxy !== false ) {
            if ( Binance.options.verbose ) Binance.options.log( 'using proxy server ' + httpsproxy );
            let config = url.parse( httpsproxy );
            let agent = new HttpsProxyAgent( config );
            ws = new WebSocket( combineStream + queryParams, { agent: agent } );
        } else {
            ws = new WebSocket( combineStream + queryParams );
        }

        ws.reconnect = Binance.options.reconnect;
        ws.endpoint = stringHash( queryParams );
        ws.isAlive = false;
        if ( Binance.options.verbose ) {
            Binance.options.log( 'CombinedStream: Subscribed to [' + ws.endpoint + '] ' + queryParams );
        }
        ws.on( 'open', handleSocketOpen.bind( ws, opened_callback ) );
        ws.on( 'pong', handleSocketHeartbeat );
        ws.on( 'error', handleSocketError );
        ws.on( 'close', handleSocketClose.bind( ws, reconnect ) );
        ws.on( 'message', data => {
            try {
                callback( JSON.parse( data ).data );
            } catch ( error ) {
                Binance.options.log( 'CombinedStream: Parse error: ' + error.message );
            }
        } );
        return ws;
    };

    /**
     * Used to terminate a web socket
     * @param {string} endpoint - endpoint identifier associated with the web socket
     * @param {boolean} reconnect - auto reconnect after termination
     * @return {undefined}
     */
    const terminate = function ( endpoint, reconnect = false ) {
        let ws = Binance.subscriptions[endpoint];
        if ( !ws ) return;
        ws.removeAllListeners( 'message' );
        ws.reconnect = reconnect;
        ws.terminate();
    }

    /**
     * Used as part of the user data websockets callback
     * @param {object} data - user data callback data type
     * @return {undefined}
     */
    const userDataHandler = data => {
        let type = data.e;
        if ( type === 'outboundAccountInfo' ) {
            Binance.options.balance_callback( data );
        } else if ( type === 'executionReport' ) {
            if ( Binance.options.execution_callback ) Binance.options.execution_callback( data );
        } else if ( type === 'listStatus' ) {
            if ( Binance.options.list_status_callback ) Binance.options.list_status_callback( data );
        } else if ( type === 'outboundAccountPosition' ) {
            // TODO: Does this mean something?
        } else {
            Binance.options.log( 'Unexpected userData: ' + type );
        }
    };

    /**
     * Used as part of the user data websockets callback
     * @param {object} data - user data callback data type
     * @return {undefined}
     */
    const userMarginDataHandler = data => {
        let type = data.e;
        if ( type === 'outboundAccountInfo' ) {
            Binance.options.margin_balance_callback( data );
        } else if ( type === 'executionReport' ) {
            if ( Binance.options.margin_execution_callback ) Binance.options.margin_execution_callback( data );
        } else if ( type === 'listStatus' ) {
            if ( Binance.options.margin_list_status_callback ) Binance.options.margin_list_status_callback( data );
        } else if ( type === 'outboundAccountPosition' ) {
            // TODO: Does this mean something?
        } else {
            Binance.options.log( 'Unexpected userMarginData: ' + type );
        }
    };

    /**
     * Converts the previous day stream into friendly object
     * @param {object} data - user data callback data type
     * @return {object} - user friendly data type
     */
    const prevDayConvertData = data => {
        let convertData = data => {
            let {
                e: eventType,
                E: eventTime,
                s: symbol,
                p: priceChange,
                P: percentChange,
                w: averagePrice,
                x: prevClose,
                c: close,
                Q: closeQty,
                b: bestBid,
                B: bestBidQty,
                a: bestAsk,
                A: bestAskQty,
                o: open,
                h: high,
                l: low,
                v: volume,
                q: quoteVolume,
                O: openTime,
                C: closeTime,
                F: firstTradeId,
                L: lastTradeId,
                n: numTrades
            } = data;
            return {
                eventType,
                eventTime,
                symbol,
                priceChange,
                percentChange,
                averagePrice,
                prevClose,
                close,
                closeQty,
                bestBid,
                bestBidQty,
                bestAsk,
                bestAskQty,
                open,
                high,
                low,
                volume,
                quoteVolume,
                openTime,
                closeTime,
                firstTradeId,
                lastTradeId,
                numTrades
            };
        }
        if ( Array.isArray( data ) ) {
            const result = [];
            for ( let obj of data ) {
                let converted = convertData( obj );
                result.push( converted );
            }
            return result;
            // eslint-disable-next-line no-else-return
        } else {
            return convertData( data );
        }
    }

    /**
     * Parses the previous day stream and calls the user callback with friendly object
     * @param {object} data - user data callback data type
     * @param {function} callback - user data callback data type
     * @return {undefined}
     */
    const prevDayStreamHandler = ( data, callback ) => {
        const converted = prevDayConvertData( data );
        callback( null, converted );
    };

    /**
     * Gets the price of a given symbol or symbols
     * @param {array} data - array of symbols
     * @return {array} - symbols with their current prices
     */
    const priceData = ( data ) => {
        const prices = {};
        if ( Array.isArray( data ) ) {
            for ( let obj of data ) {
                prices[obj.symbol] = obj.price;
            }
        } else { // Single price returned
            prices[data.symbol] = data.price;
        }
        return prices;
    };

    /**
     * Used by bookTickers to format the bids and asks given given symbols
     * @param {array} data - array of symbols
     * @return {object} - symbols with their bids and asks data
     */
    const bookPriceData = data => {
        let prices = {};
        for ( let obj of data ) {
            prices[obj.symbol] = {
                bid: obj.bidPrice,
                bids: obj.bidQty,
                ask: obj.askPrice,
                asks: obj.askQty
            };
        }
        return prices;
    };

    /**
     * Used by balance to get the balance data
     * @param {array} data - account info object
     * @return {object} - balances hel with available, onorder amounts
     */
    const balanceData = data => {
        let balances = {};
        if ( typeof data === 'undefined' ) return {};
        if ( typeof data.balances === 'undefined' ) {
            Binance.options.log( 'balanceData error', data );
            return {};
        }
        for ( let obj of data.balances ) {
            balances[obj.asset] = { available: obj.free, onOrder: obj.locked };
        }
        return balances;
    };

    /**
     * Used by web sockets depth and populates OHLC and info
     * @param {string} symbol - symbol to get candlestick info
     * @param {string} interval - time interval, 1m, 3m, 5m ....
     * @param {array} ticks - tick array
     * @return {undefined}
     */
    const klineData = ( symbol, interval, ticks ) => { // Used for /depth
        let last_time = 0;
        if ( isIterable( ticks ) ) {
            for ( let tick of ticks ) {
                // eslint-disable-next-line no-unused-vars
                let [time, open, high, low, close, volume, closeTime, assetVolume, trades, buyBaseVolume, buyAssetVolume, ignored] = tick;
                Binance.ohlc[symbol][interval][time] = { open: open, high: high, low: low, close: close, volume: volume };
                last_time = time;
            }

            Binance.info[symbol][interval].timestamp = last_time;
        }
    };

    /**
     * Combines all OHLC data with latest update
     * @param {string} symbol - the symbol
     * @param {string} interval - time interval, 1m, 3m, 5m ....
     * @return {array} - interval data for given symbol
     */
    const klineConcat = ( symbol, interval ) => {
        let output = Binance.ohlc[symbol][interval];
        if ( typeof Binance.ohlcLatest[symbol][interval].time === 'undefined' ) return output;
        const time = Binance.ohlcLatest[symbol][interval].time;
        const last_updated = Object.keys( Binance.ohlc[symbol][interval] ).pop();
        if ( time >= last_updated ) {
            output[time] = Binance.ohlcLatest[symbol][interval];
            delete output[time].time;
            output[time].isFinal = false;
        }
        return output;
    };

    /**
     * Used for websocket @kline
     * @param {string} symbol - the symbol
     * @param {object} kline - object with kline info
     * @param {string} firstTime - time filter
     * @return {undefined}
     */
    const klineHandler = ( symbol, kline, firstTime = 0 ) => {
        // TODO: add Taker buy base asset volume
        // eslint-disable-next-line no-unused-vars
        let { e: eventType, E: eventTime, k: ticks } = kline;
        // eslint-disable-next-line no-unused-vars
        let { o: open, h: high, l: low, c: close, v: volume, i: interval, x: isFinal, q: quoteVolume, t: time } = ticks; //n:trades, V:buyVolume, Q:quoteBuyVolume
        if ( time <= firstTime ) return;
        if ( !isFinal ) {
            if ( typeof Binance.ohlcLatest[symbol][interval].time !== 'undefined' ) {
                if ( Binance.ohlcLatest[symbol][interval].time > time ) return;
            }
            Binance.ohlcLatest[symbol][interval] = { open: open, high: high, low: low, close: close, volume: volume, time: time };
            return;
        }
        // Delete an element from the beginning so we don't run out of memory
        const first_updated = Object.keys( Binance.ohlc[symbol][interval] ).shift();
        if ( first_updated ) delete Binance.ohlc[symbol][interval][first_updated];
        Binance.ohlc[symbol][interval][time] = { open: open, high: high, low: low, close: close, volume: volume };
    };

    /**
     * Used for /depth endpoint
     * @param {object} data - containing the bids and asks
     * @return {undefined}
     */
    const depthData = data => {
        if ( !data ) return { bids: [], asks: [] };
        let bids = {}, asks = {}, obj;
        if ( typeof data.bids !== 'undefined' ) {
            for ( obj of data.bids ) {
                bids[obj[0]] = parseFloat( obj[1] );
            }
        }
        if ( typeof data.asks !== 'undefined' ) {
            for ( obj of data.asks ) {
                asks[obj[0]] = parseFloat( obj[1] );
            }
        }
        return { lastUpdateId: data.lastUpdateId, bids: bids, asks: asks };
    }

    /**
     * Used for /depth endpoint
     * @param {object} depth - information
     * @return {undefined}
     */
    const depthHandler = depth => {
        let symbol = depth.s, obj;
        let context = Binance.depthCacheContext[symbol];
        let updateDepthCache = () => {
            Binance.depthCache[symbol].eventTime = depth.E;
            for ( obj of depth.b ) { //bids
                if ( obj[1] === '0.00000000' ) {
                    delete Binance.depthCache[symbol].bids[obj[0]];
                } else {
                    Binance.depthCache[symbol].bids[obj[0]] = parseFloat( obj[1] );
                }
            }
            for ( obj of depth.a ) { //asks
                if ( obj[1] === '0.00000000' ) {
                    delete Binance.depthCache[symbol].asks[obj[0]];
                } else {
                    Binance.depthCache[symbol].asks[obj[0]] = parseFloat( obj[1] );
                }
            }
            context.skipCount = 0;
            context.lastEventUpdateId = depth.u;
            context.lastEventUpdateTime = depth.E;
        };

        // This now conforms 100% to the Binance docs constraints on managing a local order book
        if ( context.lastEventUpdateId ) {
            const expectedUpdateId = context.lastEventUpdateId + 1;
            if ( depth.U <= expectedUpdateId ) {
                updateDepthCache();
            } else {
                let msg = 'depthHandler: [' + symbol + '] The depth cache is out of sync.';
                msg += ' Symptom: Unexpected Update ID. Expected "' + expectedUpdateId + '", got "' + depth.U + '"';
                if ( Binance.options.verbose ) Binance.options.log( msg );
                throw new Error( msg );
            }
        } else if ( depth.U > context.snapshotUpdateId + 1 ) {
            /* In this case we have a gap between the data of the stream and the snapshot.
             This is an out of sync error, and the connection must be torn down and reconnected. */
            let msg = 'depthHandler: [' + symbol + '] The depth cache is out of sync.';
            msg += ' Symptom: Gap between snapshot and first stream data.';
            if ( Binance.options.verbose ) Binance.options.log( msg );
            throw new Error( msg );
        } else if ( depth.u < context.snapshotUpdateId + 1 ) {
            /* In this case we've received data that we've already had since the snapshot.
             This isn't really an issue, and we can just update the cache again, or ignore it entirely. */

            // do nothing
        } else {
            // This is our first legal update from the stream data
            updateDepthCache();
        }
    };

    /**
     * Gets depth cache for given symbol
     * @param {string} symbol - the symbol to fetch
     * @return {object} - the depth cache object
     */
    const getDepthCache = symbol => {
        if ( typeof Binance.depthCache[symbol] === 'undefined' ) return { bids: {}, asks: {} };
        return Binance.depthCache[symbol];
    };

    /**
     * Calculate Buy/Sell volume from DepthCache
     * @param {string} symbol - the symbol to fetch
     * @return {object} - the depth volume cache object
     */
    const depthVolume = symbol => {
        let cache = getDepthCache( symbol ), quantity, price;
        let bidbase = 0, askbase = 0, bidqty = 0, askqty = 0;
        for ( price in cache.bids ) {
            quantity = cache.bids[price];
            bidbase += parseFloat( ( quantity * parseFloat( price ) ).toFixed( 8 ) );
            bidqty += quantity;
        }
        for ( price in cache.asks ) {
            quantity = cache.asks[price];
            askbase += parseFloat( ( quantity * parseFloat( price ) ).toFixed( 8 ) );
            askqty += quantity;
        }
        return { bids: bidbase, asks: askbase, bidQty: bidqty, askQty: askqty };
    };

    /**
     * Checks whether or not an array contains any duplicate elements
     * @param {array} array - the array to check
     * @return {boolean} - true or false
     */
    const isArrayUnique = array => {
        let s = new Set( array );
        return s.size === array.length;
    };
    return {
        /**
        * Gets depth cache for given symbol
        * @param {symbol} symbol - get depch cache for this symbol
        * @return {object} - object
        */
        depthCache: symbol => {
            return getDepthCache( symbol );
        },

        /**
        * Gets depth volume for given symbol
        * @param {symbol} symbol - get depch volume for this symbol
        * @return {object} - object
        */
        depthVolume: symbol => {
            return depthVolume( symbol );
        },

        /**
        * Count decimal places
        * @param {float} float - get the price precision point
        * @return {int} - number of place
        */
        getPrecision: function ( float ) {
            if ( !float || Number.isInteger( float ) ) return 0;
            return float.toString().split( '.' )[1].length || 0;
        },

        /**
        * rounds number with given step
        * @param {float} qty - quantity to round
        * @param {float} stepSize - stepSize as specified by exchangeInfo
        * @return {float} - number
        */
        roundStep: function ( qty, stepSize ) {
            // Integers do not require rounding
            if ( Number.isInteger( qty ) ) return qty;
            const qtyString = qty.toFixed( 16 );
            const desiredDecimals = Math.max( stepSize.indexOf( '1' ) - 1, 0 );
            const decimalIndex = qtyString.indexOf( '.' );
            return parseFloat( qtyString.slice( 0, decimalIndex + desiredDecimals + 1 ) );
        },

        /**
        * rounds price to required precision
        * @param {float} price - price to round
        * @param {float} tickSize - tickSize as specified by exchangeInfo
        * @return {float} - number
        */
        roundTicks: function ( price, tickSize ) {
            const formatter = new Intl.NumberFormat( 'en-US', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 8 } );
            const precision = formatter.format( tickSize ).split( '.' )[1].length || 0;
            if ( typeof price === 'string' ) price = parseFloat( price );
            return price.toFixed( precision );
        },

        /**
        * Gets percentage of given numbers
        * @param {float} min - the smaller number
        * @param {float} max - the bigger number
        * @param {int} width - percentage width
        * @return {float} - percentage
        */
        percent: function ( min, max, width = 100 ) {
            return ( min * 0.01 ) / ( max * 0.01 ) * width;
        },

        /**
        * Gets the sum of an array of numbers
        * @param {array} array - the number to add
        * @return {float} - sum
        */
        sum: function ( array ) {
            return array.reduce( ( a, b ) => a + b, 0 );
        },

        /**
        * Reverses the keys of an object
        * @param {object} object - the object
        * @return {object} - the object
        */
        reverse: function ( object ) {
            let range = Object.keys( object ).reverse(), output = {};
            for ( let price of range ) {
                output[price] = object[price];
            }
            return output;
        },

        /**
        * Converts an object to an array
        * @param {object} obj - the object
        * @return {array} - the array
        */
        array: function( obj ) {
            return Object.keys( obj ).map( function ( key ) {
                return [Number( key ), obj[key]];
            } );
        },

        /**
        * Sorts bids
        * @param {string} symbol - the object
        * @param {int} max - the max number of bids
        * @param {string} baseValue - the object
        * @return {object} - the object
        */
        sortBids: function ( symbol, max = Infinity, baseValue = false ) {
            let object = {}, count = 0, cache;
            if ( typeof symbol === 'object' ) cache = symbol;
            else cache = getDepthCache( symbol ).bids;
            let sorted = Object.keys( cache ).sort( function ( a, b ) {
                return parseFloat( b ) - parseFloat( a )
            } );
            let cumulative = 0;
            for ( let price of sorted ) {
                if ( baseValue === 'cumulative' ) {
                    cumulative += parseFloat( cache[price] );
                    object[price] = cumulative;
                } else if ( !baseValue ) object[price] = parseFloat( cache[price] );
                else object[price] = parseFloat( ( cache[price] * parseFloat( price ) ).toFixed( 8 ) );
                if ( ++count >= max ) break;
            }
            return object;
        },

        /**
        * Sorts asks
        * @param {string} symbol - the object
        * @param {int} max - the max number of bids
        * @param {string} baseValue - the object
        * @return {object} - the object
        */
        sortAsks: function ( symbol, max = Infinity, baseValue = false ) {
            let object = {}, count = 0, cache;
            if ( typeof symbol === 'object' ) cache = symbol;
            else cache = getDepthCache( symbol ).asks;
            let sorted = Object.keys( cache ).sort( function ( a, b ) {
                return parseFloat( a ) - parseFloat( b );
            } );
            let cumulative = 0;
            for ( let price of sorted ) {
                if ( baseValue === 'cumulative' ) {
                    cumulative += parseFloat( cache[price] );
                    object[price] = cumulative;
                } else if ( !baseValue ) object[price] = parseFloat( cache[price] );
                else object[price] = parseFloat( ( cache[price] * parseFloat( price ) ).toFixed( 8 ) );
                if ( ++count >= max ) break;
            }
            return object;
        },

        /**
        * Returns the first property of an object
        * @param {object} object - the object to get the first member
        * @return {string} - the object key
        */
        first: function ( object ) {
            return Object.keys( object ).shift();
        },

        /**
        * Returns the last property of an object
        * @param {object} object - the object to get the first member
        * @return {string} - the object key
        */
        last: function ( object ) {
            return Object.keys( object ).pop();
        },

        /**
        * Returns an array of properties starting at start
        * @param {object} object - the object to get the properties form
        * @param {int} start - the starting index
        * @return {array} - the array of entires
        */
        slice: function ( object, start = 0 ) {
            return Object.entries( object ).slice( start ).map( entry => entry[0] );
        },

        /**
        * Gets the minimum key form object
        * @param {object} object - the object to get the properties form
        * @return {string} - the minimum key
        */
        min: function ( object ) {
            return Math.min.apply( Math, Object.keys( object ) );
        },

        /**
        * Gets the maximum key form object
        * @param {object} object - the object to get the properties form
        * @return {string} - the minimum key
        */
        max: function ( object ) {
            return Math.max.apply( Math, Object.keys( object ) );
        },

        /**
        * Sets an option given a key and value
        * @param {string} key - the key to set
        * @param {object} value - the value of the key
        * @return {undefined}
        */
        setOption: function ( key, value ) {
            Binance.options[key] = value;
        },

        /**
        * Gets an option given a key
        * @param {string} key - the key to set
        * @return {undefined}
        */
        getOption: function ( key ) {
            return Binance.options[key];
        },

        /**
        * Returns the entire info object
        * @return {object} - the info object
        */
        getInfo: function() {
            return Binance.info;
        },

        /**
        * Returns the entire options object
        * @return {object} - the options object
        */
        getOptions: function() {
            return Binance.options;
        },

        /**
        * Gets an option given a key
        * @param {object} opt - the object with the class configuration
        * @param {function} callback - the callback function
        * @return {undefined}
        */
        options: setOptions,

        /**
        * Creates an order
        * @param {string} side - BUY or SELL
        * @param {string} symbol - the symbol to buy
        * @param {numeric} quantity - the quantity required
        * @param {numeric} price - the price to pay for each unit
        * @param {object} flags - aadditionalbuy order flags
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        order: function ( side, symbol, quantity, price, flags = {}, callback = false ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    order( side, symbol, quantity, price, flags, callback );
                } )
            } else {
                order( side, symbol, quantity, price, flags, callback );
            }
        },

        /**
        * Creates a buy order
        * @param {string} symbol - the symbol to buy
        * @param {numeric} quantity - the quantity required
        * @param {numeric} price - the price to pay for each unit
        * @param {object} flags - additional buy order flags
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        buy: function( symbol, quantity, price, flags = {}, callback = false ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    order( 'BUY', symbol, quantity, price, flags, callback );
                } )
            } else {
                order( 'BUY', symbol, quantity, price, flags, callback );
            }
        },

        /**
        * Creates a sell order
        * @param {string} symbol - the symbol to sell
        * @param {numeric} quantity - the quantity required
        * @param {numeric} price - the price to sell each unit for
        * @param {object} flags - additional order flags
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        sell: function ( symbol, quantity, price, flags = {}, callback = false ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    order( 'SELL', symbol, quantity, price, flags, callback );
                } )
            } else {
                order( 'SELL', symbol, quantity, price, flags, callback );
            }

        },

        /**
        * Creates a market buy order
        * @param {string} symbol - the symbol to buy
        * @param {numeric} quantity - the quantity required
        * @param {object} flags - additional buy order flags
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        marketBuy: function ( symbol, quantity, flags = { type: 'MARKET' }, callback = false ) {
            if ( typeof flags === 'function' ) { // Accept callback as third parameter
                callback = flags;
                flags = { type: 'MARKET' };
            }
            if ( typeof flags.type === 'undefined' ) flags.type = 'MARKET';
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    order( 'BUY', symbol, quantity, 0, flags, callback );
                } )
            } else {
                order( 'BUY', symbol, quantity, 0, flags, callback );
            }
        },

        /**
        * Creates a market sell order
        * @param {string} symbol - the symbol to sell
        * @param {numeric} quantity - the quantity required
        * @param {object} flags - additional sell order flags
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        marketSell: function ( symbol, quantity, flags = { type: 'MARKET' }, callback = false ) {
            if ( typeof flags === 'function' ) { // Accept callback as third parameter
                callback = flags;
                flags = { type: 'MARKET' };
            }
            if ( typeof flags.type === 'undefined' ) flags.type = 'MARKET';
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    order( 'SELL', symbol, quantity, 0, flags, callback );
                } )
            } else {
                order( 'SELL', symbol, quantity, 0, flags, callback );
            }
        },

        /**
        * Cancels an order
        * @param {string} symbol - the symbol to cancel
        * @param {string} orderid - the orderid to cancel
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        cancel: function ( symbol, orderid, callback = false ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/order', { symbol: symbol, orderId: orderid }, function ( error, data ) {
                        return callback.call( this, error, data, symbol );
                    }, 'DELETE' );
                } )
            } else {
                signedRequest( base + 'v3/order', { symbol: symbol, orderId: orderid }, function ( error, data ) {
                    return callback.call( this, error, data, symbol );
                }, 'DELETE' );
            }
        },

        /**
        * Gets the status of an order
        * @param {string} symbol - the symbol to check
        * @param {string} orderid - the orderid to check
        * @param {function} callback - the callback function
        * @param {object} flags - any additional flags
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        orderStatus: function ( symbol, orderid, callback, flags = {} ) {
            let parameters = Object.assign( { symbol: symbol, orderId: orderid }, flags );
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/order', parameters, function ( error, data ) {
                        return callback.call( this, error, data, symbol );
                    } );
                } )
            } else {
                signedRequest( base + 'v3/order', parameters, function ( error, data ) {
                    return callback.call( this, error, data, symbol );
                } );
            }
        },

        /**
        * Gets open orders
        * @param {string} symbol - the symbol to get
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        openOrders: function ( symbol, callback ) {
            let parameters = symbol ? { symbol: symbol } : {};
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/openOrders', parameters, function ( error, data ) {
                        return callback.call( this, error, data, symbol );
                    } );
                } )
            } else {
                signedRequest( base + 'v3/openOrders', parameters, function ( error, data ) {
                    return callback.call( this, error, data, symbol );
                } );
            }
        },

        /**
        * Cancels all order of a given symbol
        * @param {string} symbol - the symbol to cancel all orders for
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        cancelOrders: function ( symbol, callback = false ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/openOrders', { symbol: symbol }, function ( error, json ) {
                        if ( json.length === 0 ) {
                            return callback.call( this, 'No orders present for this symbol', {}, symbol );
                        }
                        for ( let obj of json ) {
                            let quantity = obj.origQty - obj.executedQty;
                            Binance.options.log( 'cancel order: ' + obj.side + ' ' + symbol + ' ' + quantity + ' @ ' + obj.price + ' #' + obj.orderId );
                            signedRequest( base + 'v3/order', { symbol: symbol, orderId: obj.orderId }, function ( error, data ) {
                                return callback.call( this, error, data, symbol );
                            }, 'DELETE' );
                        }
                    } );
                } )
            } else {
                signedRequest( base + 'v3/openOrders', { symbol: symbol }, function ( error, json ) {
                    if ( json.length === 0 ) {
                        return callback.call( this, 'No orders present for this symbol', {}, symbol );
                    }
                    for ( let obj of json ) {
                        let quantity = obj.origQty - obj.executedQty;
                        Binance.options.log( 'cancel order: ' + obj.side + ' ' + symbol + ' ' + quantity + ' @ ' + obj.price + ' #' + obj.orderId );
                        signedRequest( base + 'v3/order', { symbol: symbol, orderId: obj.orderId }, function ( error, data ) {
                            return callback.call( this, error, data, symbol );
                        }, 'DELETE' );
                    }
                } );
            }
        },

        /**
        * Gets all order of a given symbol
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @param {object} options - additional options
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        allOrders: function ( symbol, callback, options = {} ) {
            let parameters = Object.assign( { symbol: symbol }, options );
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/allOrders', parameters, function ( error, data ) {
                        return callback.call( this, error, data, symbol );
                    } );
                } )
            } else {
                signedRequest( base + 'v3/allOrders', parameters, function ( error, data ) {
                    return callback.call( this, error, data, symbol );
                } );
            }
        },

        /**
        * Gets the depth information for a given symbol
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @param {int} limit - limit the number of returned orders
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        depth: function ( symbol, callback, limit = 100 ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    publicRequest( base + 'v1/depth', { symbol: symbol, limit: limit }, function ( error, data ) {
                        return callback.call( this, error, depthData( data ), symbol );
                    } );
                } )
            } else {
                publicRequest( base + 'v1/depth', { symbol: symbol, limit: limit }, function ( error, data ) {
                    return callback.call( this, error, depthData( data ), symbol );
                } );
            }
        },

        /**
        * Gets the average prices of a given symbol
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        avgPrice: function ( symbol, callback = false ) {
            let opt = {
                url: base + 'v3/avgPrice?symbol=' + symbol,
                timeout: Binance.options.recvWindow
            };
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    request( addProxy( opt ), ( error, response, body ) => {
                        if ( error ) return reject( error );
                        if ( response.statusCode !== 200 ) return reject( response );
                        let result = {};
                        result[symbol] = JSON.parse( response.body ).price;
                        return resolve( result );
                    } );
                } );
            }
            request( addProxy( opt ), ( error, response, body ) => {
                if ( error ) return callback( error );
                if ( response.statusCode !== 200 ) return callback( response );
                let result = {};
                result[symbol] = JSON.parse( response.body ).price;
                return callback( null, result );
            } );
        },

        /**
        * Gets the prices of a given symbol(s)
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        prices: function ( symbol, callback = false ) {
            const params = typeof symbol === 'string' ? '?symbol=' + symbol : '';
            if ( typeof symbol === 'function' ) callback = symbol; // backwards compatibility

            let opt = {
                url: base + 'v3/ticker/price' + params,
                timeout: Binance.options.recvWindow
            };
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    request( addProxy( opt ), ( error, response, body ) => {
                        if ( error ) return reject( error );
                        if ( response.statusCode !== 200 ) return reject( response );
                        return resolve( priceData( JSON.parse( body ) ) );
                    } );
                } );
            }
            request( addProxy( opt ), ( error, response, body ) => {
                if ( error ) return callback( error );
                if ( response.statusCode !== 200 ) return callback( response );
                return callback( null, priceData( JSON.parse( body ) ) );
            } );
        },

        /**
        * Gets the book tickers of given symbol(s)
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        bookTickers: function ( symbol, callback ) {
            const params = typeof symbol === 'string' ? '?symbol=' + symbol : '';
            if ( typeof symbol === 'function' ) callback = symbol; // backwards compatibility
            let opt = {
                url: base + 'v3/ticker/bookTicker' + params,
                timeout: Binance.options.recvWindow
            };
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    request( addProxy( opt ), function ( error, response, body ) {
                        if ( error ) return reject( error );
                        if ( response.statusCode !== 200 ) return reject( response );
                        const result = symbol ? JSON.parse( body ) : bookPriceData( JSON.parse( body ) );
                        return resolve( result );
                    } );
                } );
            }
            request( addProxy( opt ), ( error, response, body ) => {
                if ( error ) return callback( error );
                if ( response.statusCode !== 200 ) return callback( response );
                const result = symbol ? JSON.parse( body ) : bookPriceData( JSON.parse( body ) );
                return callback( null, result );
            } );
        },

        /**
        * Gets the prevday percentage change
        * @param {string} symbol - the symbol or symbols
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        prevDay: function ( symbol, callback ) {
            let input = symbol ? { symbol: symbol } : {};
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    publicRequest( base + 'v1/ticker/24hr', input, ( error, data ) => {
                        return callback.call( this, error, data, symbol );
                    } );
                } )
            } else {
                publicRequest( base + 'v1/ticker/24hr', input, ( error, data ) => {
                    return callback.call( this, error, data, symbol );
                } );
            }
        },

        /**
        * Gets the the exchange info
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        exchangeInfo: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    publicRequest( base + 'v1/exchangeInfo', {}, callback );
                } )
            } else {
                publicRequest( base + 'v1/exchangeInfo', {}, callback );
            }
        },

        /**
        * Gets the dust log for user
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        dustLog: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + '/v3/userAssetDribbletLog.html', {}, callback );
                } )
            } else {
                signedRequest( wapi + '/v3/userAssetDribbletLog.html', {}, callback );
            }
        },

        /**
        * Gets the the system status
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        systemStatus: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    publicRequest( wapi + 'v3/systemStatus.html', {}, callback );
                } )
            } else {
                publicRequest( wapi + 'v3/systemStatus.html', {}, callback );
            }
        },

        /**
        * Withdraws asset to given wallet id
        * @param {string} asset - the asset symbol
        * @param {string} address - the wallet to transfer it to
        * @param {number} amount - the amount to transfer
        * @param {string} addressTag - and addtional address tag
        * @param {function} callback - the callback function
        * @param {string} name - the name to save the address as. Set falsy to prevent Binance saving to address book
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        withdraw: function ( asset, address, amount, addressTag = false, callback = false, name = 'API Withdraw' ) {
            let params = { asset, address, amount };
            if ( addressTag ) params.addressTag = addressTag;
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + 'v3/withdraw.html', params, callback, 'POST' );
                } )
            } else {
                signedRequest( wapi + 'v3/withdraw.html', params, callback, 'POST' );
            }
        },

        /**
        * Get the Withdraws history for a given asset
        * @param {function} callback - the callback function
        * @param {object} params - supports limit and fromId parameters
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        withdrawHistory: function ( callback, params = {} ) {
            if ( typeof params === 'string' ) params = { asset: params };
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + 'v3/withdrawHistory.html', params, callback );
                } )
            } else {
                signedRequest( wapi + 'v3/withdrawHistory.html', params, callback );
            }
        },

        fiatWithdrawHistory: async ( params = {} ) => {
          return promiseRequest('v1/fiatpayment/query/withdraw/history', params, { base:sapi, type:'SIGNED'});
        },

        /**
        * Get the deposit history
        * @param {function} callback - the callback function
        * @param {object} params - additional params
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        depositHistory: function ( callback, params = {} ) {
            if ( typeof params === 'string' ) params = { asset: params }; // Support 'asset' (string) or optional parameters (object)
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + 'v3/depositHistory.html', params, callback );
                } )
            } else {
                signedRequest( wapi + 'v3/depositHistory.html', params, callback );
            }
        },

        fiatDepositHistory: async ( params = {} ) => {
          return promiseRequest('v1/fiatpayment/query/deposit/history', params, { base:sapi, type:'SIGNED'});
        },

        /**
        * Get the deposit history for given asset
        * @param {string} asset - the asset
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        depositAddress: function ( asset, callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + 'v3/depositAddress.html', { asset: asset }, callback );
                } )
            } else {
                signedRequest( wapi + 'v3/depositAddress.html', { asset: asset }, callback );
            }
        },

        /**
        * Get the account status
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        accountStatus: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + 'v3/accountStatus.html', {}, callback );
                } )
            } else {
                signedRequest( wapi + 'v3/accountStatus.html', {}, callback );
            }
        },

        /**
        * Get the trade fee
        * @param {function} callback - the callback function
        * @param {string} symbol (optional)
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        tradeFee: function ( callback, symbol = false ) {
            let params = symbol ? { symbol: symbol } : {};
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + 'v3/tradeFee.html', params, callback );
                } )
            } else {
                signedRequest( wapi + 'v3/tradeFee.html', params, callback );
            }
        },

        /**
        * Fetch asset detail (minWithdrawAmount, depositStatus, withdrawFee, withdrawStatus, depositTip)
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        assetDetail: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( wapi + 'v3/assetDetail.html', {}, callback );
                } )
            } else {
                signedRequest( wapi + 'v3/assetDetail.html', {}, callback );
            }
        },

        /**
        * Get the account
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        account: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/account', {}, callback );
                } )
            } else {
                signedRequest( base + 'v3/account', {}, callback );
            }
        },

        /**
        * Get the balance data
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        balance: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/account', {}, function ( error, data ) {
                        callback( error, balanceData( data ) );
                    } );
                } )
            } else {
                signedRequest( base + 'v3/account', {}, function ( error, data ) {
                    callback( error, balanceData( data ) );
                } );
            }
        },

        /**
        * Get trades for a given symbol
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @param {object} options - additional options
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        trades: ( symbol, callback, options = {} ) => {
            let parameters = Object.assign( { symbol: symbol }, options );
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( base + 'v3/myTrades', parameters, function ( error, data ) {
                        return callback.call( this, error, data, symbol );
                    } );
                } )
            } else {
                signedRequest( base + 'v3/myTrades', parameters, function ( error, data ) {
                    return callback.call( this, error, data, symbol );
                } );
            }
        },

        /**
        * Tell api to use the server time to offset time indexes
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        useServerTime: ( callback = false ) => {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    apiRequest( base + 'v1/time', {}, function ( error, response ) {
                        Binance.info.timeOffset = response.serverTime - new Date().getTime();
                        //Binance.options.log("server time set: ", response.serverTime, Binance.info.timeOffset);
                        callback( error, response );
                    } );
                } )
            } else {
                apiRequest( base + 'v1/time', {}, function ( error, response ) {
                    Binance.info.timeOffset = response.serverTime - new Date().getTime();
                    //Binance.options.log("server time set: ", response.serverTime, Binance.info.timeOffset);
                    callback( error, response );
                } );
            }
        },

        /**
        * Gets the time
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        time: function ( callback ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    apiRequest( base + 'v1/time', {}, callback );
                } )
            } else {
                apiRequest( base + 'v1/time', {}, callback );
            }
        },

        /**
        * Get agg trades for given symbol
        * @param {string} symbol - the symbol
        * @param {object} options - addtional optoins
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        aggTrades: function ( symbol, options = {}, callback = false ) { //fromId startTime endTime limit
            let parameters = Object.assign( { symbol }, options );
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    marketRequest( base + 'v1/aggTrades', parameters, callback );
                } )
            } else {
                marketRequest( base + 'v1/aggTrades', parameters, callback );
            }
        },

        /**
        * Get the recent trades
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @param {int} limit - limit the number of items returned
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        recentTrades: function ( symbol, callback, limit = 500 ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    marketRequest( base + 'v1/trades', { symbol: symbol, limit: limit }, callback );
                } )
            } else {
                marketRequest( base + 'v1/trades', { symbol: symbol, limit: limit }, callback );
            }
        },

        /**
        * Get the historical trade info
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @param {int} limit - limit the number of items returned
        * @param {int} fromId - from this id
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        historicalTrades: function ( symbol, callback, limit = 500, fromId = false ) {
            let parameters = { symbol: symbol, limit: limit };
            if ( fromId ) parameters.fromId = fromId;
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    marketRequest( base + 'v1/historicalTrades', parameters, callback );
                } )
            } else {
                marketRequest( base + 'v1/historicalTrades', parameters, callback );
            }
        },

        /**
        * Convert chart data to highstock array [timestamp,open,high,low,close]
        * @param {object} chart - the chart
        * @param {boolean} include_volume - to include the volume or not
        * @return {array} - an array
        */
        highstock: function ( chart, include_volume = false ) {
            let array = [];
            for ( let timestamp in chart ) {
                let obj = chart[timestamp];
                let line = [
                    Number( timestamp ),
                    parseFloat( obj.open ),
                    parseFloat( obj.high ),
                    parseFloat( obj.low ),
                    parseFloat( obj.close )
                ];
                if ( include_volume ) line.push( parseFloat( obj.volume ) );
                array.push( line );
            }
            return array;
        },

        /**
        * Populates OHLC information
        * @param {object} chart - the chart
        * @return {object} - object with candle information
        */
        ohlc: function ( chart ) {
            let open = [], high = [], low = [], close = [], volume = [];
            for ( let timestamp in chart ) { //Binance.ohlc[symbol][interval]
                let obj = chart[timestamp];
                open.push( parseFloat( obj.open ) );
                high.push( parseFloat( obj.high ) );
                low.push( parseFloat( obj.low ) );
                close.push( parseFloat( obj.close ) );
                volume.push( parseFloat( obj.volume ) );
            }
            return { open: open, high: high, low: low, close: close, volume: volume };
        },

        /**
        * Gets the candles information for a given symbol
        * intervals: 1m,3m,5m,15m,30m,1h,2h,4h,6h,8h,12h,1d,3d,1w,1M
        * @param {string} symbol - the symbol
        * @param {function} interval - the callback function
        * @param {function} callback - the callback function
        * @param {object} options - additional options
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        candlesticks: function ( symbol, interval = '5m', callback = false, options = { limit: 500 } ) {
            let params = Object.assign( { symbol: symbol, interval: interval }, options );
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    publicRequest( base + 'v1/klines', params, function ( error, data ) {
                        return callback.call( this, error, data, symbol );
                    } );
                } )
            } else {
                publicRequest( base + 'v1/klines', params, function ( error, data ) {
                    return callback.call( this, error, data, symbol );
                } );
            }
        },

        /**
        * Queries the public api
        * @param {string} url - the public api endpoint
        * @param {object} data - the data to send
        * @param {function} callback - the callback function
        * @param {string} method - the http method
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        publicRequest: function ( url, data, callback, method = 'GET' ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    publicRequest( url, data, callback, method );
                } )
            } else {
                publicRequest( url, data, callback, method );
            }
        },

        /**
        * Queries the signed api
        * @param {string} url - the signed api endpoint
        * @param {object} data - the data to send
        * @param {function} callback - the callback function
        * @param {string} method - the http method
        * @param {boolean} noDataInSignature - Prevents data from being added to signature
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        signedRequest: function ( url, data, callback, method = 'GET', noDataInSignature = false ) {
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( url, data, callback, method, noDataInSignature );
                } )
            } else {
                signedRequest( url, data, callback, method, noDataInSignature );
            }
        },

        /**
        * Gets the market asset of given symbol
        * @param {string} symbol - the public api endpoint
        * @return {undefined}
        */
        getMarket: function ( symbol ) {
            if ( symbol.endsWith( 'BTC' ) ) return 'BTC';
            else if ( symbol.endsWith( 'ETH' ) ) return 'ETH';
            else if ( symbol.endsWith( 'BNB' ) ) return 'BNB';
            else if ( symbol.endsWith( 'XRP' ) ) return 'XRP';
            else if ( symbol.endsWith( 'PAX' ) ) return 'PAX';
            else if ( symbol.endsWith( 'USDT' ) ) return 'USDT';
            else if ( symbol.endsWith( 'USDC' ) ) return 'USDC';
            else if ( symbol.endsWith( 'USDS' ) ) return 'USDS';
            else if ( symbol.endsWith( 'TUSD' ) ) return 'TUSD';
        },

        /**
        * Get the account binance lending information
        * @param {function} callback - the callback function
        * @return {promise or undefined} - omitting the callback returns a promise
        */
       lending: async ( params = {} ) => {
        return promiseRequest( 'v1/lending/union/account', params, {base:sapi, type:'SIGNED'});
       },

        //** Futures methods */
        futuresPing: async ( params = {} ) => {
            return promiseRequest( 'v1/ping', params, {base:fapi} );
        },

        futuresTime: async ( params = {} ) => {
            return promiseRequest( 'v1/time', params, {base:fapi} ).then( r => r.serverTime );
        },

        futuresExchangeInfo: async () => {
            return promiseRequest( 'v1/exchangeInfo', {}, {base:fapi} );
        },

        futuresPrices: async ( params = {} ) => {
            let data = await promiseRequest( 'v1/ticker/price', params, {base:fapi} );
            return data.reduce( ( out, i ) => ( ( out[i.symbol] =  i.price ), out ) );
        },

        futuresDaily: async ( symbol = false, params = {} ) => {
            if ( symbol ) params.symbol = symbol;
            let data = await promiseRequest( 'v1/ticker/24hr', params, {base:fapi} );
            return symbol ? data : data.reduce( ( out, i ) => ( ( out[i.symbol] = i ), out ), {} );
        },

        futuresOpenInterest: async ( symbol ) => {
            return promiseRequest( 'v1/openInterest', {symbol}, {base:fapi} ).then( r => r.openInterest );
        },

        futuresCandles: async ( symbol, interval = "30m", params = {} ) => {
            params.symbol = symbol;
            params.interval = interval;
            return promiseRequest( 'v1/klines', params, {base:fapi} );
        },

        futuresMarkPrice: async ( symbol = false ) => {
            return promiseRequest( 'v1/premiumIndex', symbol ? {symbol} : {}, {base:fapi} );
        },

        futuresTrades: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/trades', params, {base:fapi} );
        },

        futuresHistoricalTrades: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/historicalTrades', params, {base:fapi, type:'MARKET_DATA'} );
        },

        futuresAggTrades: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/aggTrades', params, {base:fapi} );
        },
        
        futuresUserTrades: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/userTrades', params, {base:fapi, type:'SIGNED'} );
        },
        
        futuresGetDataStream: async ( params = {} ) => {
            //A User Data Stream listenKey is valid for 60 minutes after creation. setInterval
            return promiseRequest( 'v1/listenKey', params, {base:fapi, type:'SIGNED', method:'POST'} );
        },

        futuresKeepDataStream: async ( params = {} ) => {
            return promiseRequest( 'v1/listenKey', params, {base:fapi, type:'SIGNED', method:'PUT'} );
        },

        futuresCloseDataStream: async ( params = {} ) => {
            return promiseRequest( 'v1/listenKey', params, {base:fapi, type:'SIGNED', method:'DELETE'} );
        },

        futuresLiquidationOrders: async ( symbol = false, params = {} ) => {
            if ( symbol ) params.symbol = symbol;
            return promiseRequest( 'v1/allForceOrders', params, {base:fapi} );
        },
        
        futuresPositionRisk: async ( params = {} ) => {
            return promiseRequest( 'v1/positionRisk', params, {base:fapi, type:'SIGNED'} ).then( r=>r.reduce( ( out, i ) => ( ( out[i.symbol] = i ), out ), {} ) );
        },

        futuresFundingRate: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/fundingRate', params, {base:fapi} );
        },

        futuresLeverageBracket: async ( symbol = false, params = {} ) => {
            if ( symbol ) params.symbol = symbol;
            return promiseRequest( 'v1/leverageBracket', params, {base:fapi, type:'MARKET_DATA'} );
        },

        // leverage 1 to 125
        futuresLeverage: async ( symbol, leverage, params = {} ) => {
            params.symbol = symbol;
            params.leverage = leverage;
            return promiseRequest( 'v1/leverage', params, {base:fapi, method:'POST', type:'SIGNED'} );
        },

        // ISOLATED, CROSSED
        futuresMarginType: async ( symbol, marginType, params = {} ) => {
            params.symbol = symbol;
            params.marginType = marginType;
            return promiseRequest( 'v1/marginType', params, {base:fapi, method:'POST', type:'SIGNED'} );
        },

        // type: 1: Add postion margin，2: Reduce postion margin
        futuresPositionMargin: async ( symbol, amount, type = 1, params = {} ) => {
            params.symbol = symbol;
            params.marginType = marginType;
            return promiseRequest( 'v1/positionMargin', params, {base:fapi, method:'POST', type:'SIGNED'} );
        },

        futuresPositionMarginHistory: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/positionMargin/history', params, {base:fapi, type:'SIGNED'} );
        },
        
        futuresIncome: async ( params = {} ) => {
            return promiseRequest( 'v1/income', params, {base:fapi, type:'SIGNED'} );
        },

        futuresBalance: async ( params = {} ) => {
            return promiseRequest( 'v1/balance', params, {base:fapi, type:'SIGNED'} );
        },

        futuresAccount: async ( params = {} ) => {
            return promiseRequest( 'v1/account', params, {base:fapi, type:'SIGNED'} );
        },

        futuresDepth: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/depth', params, {base:fapi} );
        },

        futuresQuote: async ( symbol = false, params = {} ) => {
            if ( symbol ) params.symbol = symbol;
            //let data = await promiseRequest( 'v1/ticker/bookTicker', params, {base:fapi} );
            //return data.reduce((out, i) => ((out[i.symbol] = i), out), {}),
            let data = await promiseRequest( 'v1/ticker/bookTicker', params, {base:fapi} );
            return symbol ? data : data.reduce( ( out, i ) => ( ( out[i.symbol] = i ), out ), {} );
        },

        futuresBuy: async ( symbol, quantity, price, params = {} ) => {
            return futuresOrder( 'BUY', symbol, quantity, price, params );
        },

        futuresSell: async ( symbol, quantity, price, params = {} ) => {
            return futuresOrder( 'SELL', symbol, quantity, price, params );
        },

        futuresMarketBuy: async ( symbol, quantity, params = {} ) => {
            return futuresOrder( 'BUY', symbol, quantity, false, params );
        },

        futuresMarketSell: async ( symbol, quantity, params = {} ) => {
            return futuresOrder( 'SELL', symbol, quantity, false, params );
        },
        
        futuresOrder, // side symbol quantity [price] [params]
        
        futuresOrderStatus: async ( symbol, params = {} ) => { // Either orderId or origClientOrderId must be sent
            params.symbol = symbol;
            return promiseRequest( 'v1/order', params, {base:fapi, type:'SIGNED'} );
        },

        futuresCancel: async ( symbol, params = {} ) => { // Either orderId or origClientOrderId must be sent
            params.symbol = symbol;
            return promiseRequest( 'v1/order', params, {base:fapi, type:'SIGNED', method:'DELETE'} );
        },

        futuresCancelAll: async ( symbol, params = {} ) => {
            params.symbol = symbol;
            return promiseRequest( 'v1/allOpenOrders', params, {base:fapi, type:'SIGNED', method:'DELETE'} );
        },

        futuresOpenOrders: async ( symbol = false, params = {} ) => {
            if ( symbol ) params.symbol = symbol;
            return promiseRequest( 'v1/openOrders', params, {base:fapi, type:'SIGNED'} );
        },

        futuresAllOrders: async ( symbol = false, params = {} ) => { // Get all account orders; active, canceled, or filled.
            if ( symbol ) params.symbol = symbol;
            return promiseRequest( 'v1/allOrders', params, {base:fapi, type:'SIGNED'} );
        },

        /* Coming soon:
        futuresSubscribe
        Cancel multiple orders DELETE /fapi/v1/batchOrders
        New Future Account Transfer POST https://api.binance.us/sapi/v1/futures/transfer (HMAC SHA
        Get Postion Margin Change History (TRADE)

        wss://fstream.binance.us/ws/<listenKey>
        Diff. Book Depth Streams (250ms, 100ms, or realtime): <symbol>@depth OR <symbol>@depth@100ms OR <symbol>@depth@0ms
        Partial Book Depth Streams (5, 10, 20): <symbol>@depth<levels> OR <symbol>@depth<levels>@100ms
        All Market Liquidation Order Streams: !forceOrder@arr
        All Book Tickers Stream: !bookTicker
        Individual Symbol Book Ticker Streams: <symbol>@bookTicker
        All Market Tickers Streams (24h, updates 3 seconds): <symbol>!ticker@arr
        Individual Symbol Ticker Streams (24h, 3 sec): <symbol>@ticker
        Liquidation Order Streams for specific symbol: <symbol>@forceOrder
        All Market Mini Tickers Stream (24h, 3 sec): <symbol>!miniTicker@arr
        Individual Symbol Mini Ticker Stream (24h, 3 sec): <symbol>@miniTicker
        Chart data (250ms): <symbol>@kline_<interval>
        Mark price (3 sec): <symbol>@markPrice
        Aggregate Trade Streams (100ms): <symbol>@aggTrade
        Raw streams are accessed at /ws/<streamName>
        Combined streams are accessed at /stream?streams=<streamName1>/<streamName2>/<streamName3>
        SUBSCRIBE, UNSUBSCRIBE, LIST_SUBSCRIPTIONS, SET_PROPERTY, GET_PROPERTY
        */

        /*
        const futuresOrder = (side, symbol, quantity, price = 0, flags = {}, callback = false) => {
            let opt = {
                symbol: symbol,
                side: side,
                type: 'LIMIT',
                quantity: quantity
            };
            if (typeof flags.type !== 'undefined') opt.type = flags.type;
            if (opt.type.includes('LIMIT')) {
                opt.price = price;
                opt.timeInForce = 'GTC';
            }
            if (typeof flags.timeInForce !== 'undefined') opt.timeInForce = flags.timeInForce;
            signedRequest(`${fapi}v1/order`, opt, function (error, response) {
                if (!response) {
                    if (callback) return callback(error, response);
                    else return Binance.options.log('futuresOrder error:', error);
                }
                if (callback) return callback(error, response);
                else return Binance.options.log(`futuresOrder ${side} (${symbol},${quantity},${price})`, response);
            }, 'POST');
        };*/
          
        //** Margin methods */
        /**
         * Creates an order
         * @param {string} side - BUY or SELL
         * @param {string} symbol - the symbol to buy
         * @param {numeric} quantity - the quantity required
         * @param {numeric} price - the price to pay for each unit
         * @param {object} flags - additional buy order flags
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgOrder: function ( side, symbol, quantity, price, flags = {}, callback = false ) {
            marginOrder( side, symbol, quantity, price, flags, callback );
        },

        /**
         * Creates a buy order
         * @param {string} symbol - the symbol to buy
         * @param {numeric} quantity - the quantity required
         * @param {numeric} price - the price to pay for each unit
         * @param {object} flags - additional buy order flags
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgBuy: function ( symbol, quantity, price, flags = {}, callback = false ) {
            marginOrder( 'BUY', symbol, quantity, price, flags, callback );
        },

        /**
         * Creates a sell order
         * @param {string} symbol - the symbol to sell
         * @param {numeric} quantity - the quantity required
         * @param {numeric} price - the price to sell each unit for
         * @param {object} flags - additional order flags
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgSell: function ( symbol, quantity, price, flags = {}, callback = false ) {
            marginOrder( 'SELL', symbol, quantity, price, flags, callback );
        },

        /**
         * Creates a market buy order
         * @param {string} symbol - the symbol to buy
         * @param {numeric} quantity - the quantity required
         * @param {object} flags - additional buy order flags
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgMarketBuy: function ( symbol, quantity, flags = { type: 'MARKET' }, callback = false ) {
            if ( typeof flags === 'function' ) { // Accept callback as third parameter
                callback = flags;
                flags = { type: 'MARKET' };
            }
            if ( typeof flags.type === 'undefined' ) flags.type = 'MARKET';
            marginOrder( 'BUY', symbol, quantity, 0, flags, callback );
        },

        /**
         * Creates a market sell order
         * @param {string} symbol - the symbol to sell
         * @param {numeric} quantity - the quantity required
         * @param {object} flags - additional sell order flags
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgMarketSell: function ( symbol, quantity, flags = { type: 'MARKET' }, callback = false ) {
            if ( typeof flags === 'function' ) { // Accept callback as third parameter
                callback = flags;
                flags = { type: 'MARKET' };
            }
            if ( typeof flags.type === 'undefined' ) flags.type = 'MARKET';
            marginOrder( 'SELL', symbol, quantity, 0, flags, callback );
        },

        /**
         * Cancels an order
         * @param {string} symbol - the symbol to cancel
         * @param {string} orderid - the orderid to cancel
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgCancel: function ( symbol, orderid, callback = false ) {
            signedRequest( sapi + 'v1/margin/order', { symbol: symbol, orderId: orderid }, function ( error, data ) {
                if ( callback ) return callback.call( this, error, data, symbol );
            }, 'DELETE' );
        },

        /**
        * Gets all order of a given symbol
        * @param {string} symbol - the symbol
        * @param {function} callback - the callback function
        * @param {object} options - additional options
        * @return {promise or undefined} - omitting the callback returns a promise
        */
        mgAllOrders: function ( symbol, callback, options = {} ) {
            let parameters = Object.assign( { symbol: symbol }, options );
            if ( !callback ) {
                return new Promise( ( resolve, reject ) => {
                    callback = ( error, response ) => {
                        if ( error ) {
                            reject( error );
                        } else {
                            resolve( response );
                        }
                    }
                    signedRequest( sapi + 'v1/margin/allOrders', parameters, function ( error, data ) {
                        return callback.call( this, error, data, symbol );
                    } );
                } )
            } else {
                signedRequest( sapi + 'v1/margin/allOrders', parameters, function ( error, data ) {
                    return callback.call( this, error, data, symbol );
                } );
            }
        },      

        /**
         * Gets the status of an order
         * @param {string} symbol - the symbol to check
         * @param {string} orderid - the orderid to check
         * @param {function} callback - the callback function
         * @param {object} flags - any additional flags
         * @return {undefined}
         */
        mgOrderStatus: function ( symbol, orderid, callback, flags = {} ) {
            let parameters = Object.assign( { symbol: symbol, orderId: orderid }, flags );
            signedRequest( sapi + 'v1/margin/order', parameters, function ( error, data ) {
                if ( callback ) return callback.call( this, error, data, symbol );
            } );
        },

        /**
         * Gets open orders
         * @param {string} symbol - the symbol to get
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgOpenOrders: function ( symbol, callback ) {
            let parameters = symbol ? { symbol: symbol } : {};
            signedRequest( sapi + 'v1/margin/openOrders', parameters, function ( error, data ) {
                return callback.call( this, error, data, symbol );
            } );
        },

        /**
         * Cancels all order of a given symbol
         * @param {string} symbol - the symbol to cancel all orders for
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgCancelOrders: function ( symbol, callback = false ) {
            signedRequest( sapi + 'v1/margin/openOrders', { symbol: symbol }, function ( error, json ) {
                if ( json.length === 0 ) {
                    if ( callback ) return callback.call( this, 'No orders present for this symbol', {}, symbol );
                }
                for ( let obj of json ) {
                    let quantity = obj.origQty - obj.executedQty;
                    Binance.options.log( 'cancel order: ' + obj.side + ' ' + symbol + ' ' + quantity + ' @ ' + obj.price + ' #' + obj.orderId );
                    signedRequest( sapi + 'v1/margin/order', { symbol: symbol, orderId: obj.orderId }, function ( error, data ) {
                        if ( callback ) return callback.call( this, error, data, symbol );
                    }, 'DELETE' );
                }
            } );
        },

        /**
         * Transfer from main account to margin account
         * @param {string} asset - the asset
         * @param {number} amount - the asset
         * @param {function} callback - the callback function
         * @param {object} options - additional options
         * @return {undefined}
         */
        mgTransferMainToMargin: function ( asset, amount, callback ) {
            let parameters = Object.assign( { asset: asset, amount: amount, type: 1 } );
            signedRequest( sapi + 'v1/margin/transfer', parameters, function ( error, data ) {
                if ( callback ) return callback( error, data );
            }, 'POST' );
        },

        /**
         * Transfer from margin account to main account
         * @param {string} asset - the asset
         * @param {number} amount - the asset
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgTransferMarginToMain: function ( asset, amount, callback ) {
            let parameters = Object.assign( { asset: asset, amount: amount, type: 2 } );
            signedRequest( sapi + 'v1/margin/transfer', parameters, function ( error, data ) {
                if ( callback ) return callback( error, data );
            }, 'POST' );
        },

        /**
         * Get maximum transfer-out amount of an asset
         * @param {string} asset - the asset
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        maxTransferable: function ( asset, callback ) {
            signedRequest( sapi + 'v1/margin/maxTransferable', { asset: asset }, function( error, data ) {
                if( callback ) return callback( error, data );
            });
        },

        /**
         * Margin account borrow/loan
         * @param {string} asset - the asset
         * @param {number} amount - the asset
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgBorrow: function ( asset, amount, callback ) {
            let parameters = Object.assign( { asset: asset, amount: amount } );
            signedRequest( sapi + 'v1/margin/loan', parameters, function ( error, data ) {
                if ( callback ) return callback( error, data );
            }, 'POST' );
        },

        /**
         * Margin account repay
         * @param {string} asset - the asset
         * @param {number} amount - the asset
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgRepay: function ( asset, amount, callback ) {
            let parameters = Object.assign( { asset: asset, amount: amount } );
            signedRequest( sapi + 'v1/margin/repay', parameters, function ( error, data ) {
                if ( callback ) return callback( error, data );
            }, 'POST' );
        },
        /**
         * Margin account details
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        mgAccount: function( callback ) {
            signedRequest( sapi + 'v1/margin/account', {}, function( error, data ) {
                if( callback ) return callback( error, data );
            });
        },
        /**
         * Get maximum borrow amount of an asset
         * @param {string} asset - the asset
         * @param {function} callback - the callback function
         * @return {undefined}
         */
        maxBorrowable: function ( asset, callback ) {
            signedRequest( sapi + 'v1/margin/maxBorrowable', { asset: asset }, function( error, data ) {
                if( callback ) return callback( error, data );
            });
        },

        websockets: {
            /**
             * Userdata websockets function
             * @param {function} callback - the callback function
             * @param {function} execution_callback - optional execution callback
             * @param {function} subscribed_callback - subscription callback
             * @param {function} list_status_callback - status callback
             * @return {undefined}
             */
            userData: function userData( callback, execution_callback = false, subscribed_callback = false, list_status_callback = false ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) userData( callback, execution_callback, subscribed_callback );
                };
                apiRequest( base + 'v1/userDataStream', {}, function ( error, response ) {
                    Binance.options.listenKey = response.listenKey;
                    setTimeout( function userDataKeepAlive() { // keepalive
                        try {
                            apiRequest( base + 'v1/userDataStream?listenKey=' + Binance.options.listenKey, {}, function ( err ) {
                                if ( err ) setTimeout( userDataKeepAlive, 60000 ); // retry in 1 minute
                                else setTimeout( userDataKeepAlive, 60 * 30 * 1000 ); // 30 minute keepalive
                            }, 'PUT' );
                        } catch ( error ) {
                            setTimeout( userDataKeepAlive, 60000 ); // retry in 1 minute
                        }
                    }, 60 * 30 * 1000 ); // 30 minute keepalive
                    Binance.options.balance_callback = callback;
                    Binance.options.execution_callback = execution_callback;
                    Binance.options.list_status_callback = list_status_callback;
                    const subscription = subscribe( Binance.options.listenKey, userDataHandler, reconnect );
                    if ( subscribed_callback ) subscribed_callback( subscription.endpoint );
                }, 'POST' );
            },

            /**
             * Margin Userdata websockets function
             * @param {function} callback - the callback function
             * @param {function} execution_callback - optional execution callback
             * @param {function} subscribed_callback - subscription callback
             * @param {function} list_status_callback - status callback
             * @return {undefined}
             */
            userMarginData: function userMarginData( callback, execution_callback = false, subscribed_callback = false, list_status_callback = false ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) userMarginData( callback, execution_callback, subscribed_callback );
                };
                apiRequest( sapi + 'v1/userDataStream', {}, function ( error, response ) {
                    Binance.options.listenMarginKey = response.listenKey;
                    setTimeout( function userDataKeepAlive() { // keepalive
                        try {
                            apiRequest( sapi + 'v1/userDataStream?listenKey=' + Binance.options.listenMarginKey, {}, function ( err ) {
                                if ( err ) setTimeout( userDataKeepAlive, 60000 ); // retry in 1 minute
                                else setTimeout( userDataKeepAlive, 60 * 30 * 1000 ); // 30 minute keepalive
                            }, 'PUT' );
                        } catch ( error ) {
                            setTimeout( userDataKeepAlive, 60000 ); // retry in 1 minute
                        }
                    }, 60 * 30 * 1000 ); // 30 minute keepalive
                    Binance.options.margin_balance_callback = callback;
                    Binance.options.margin_execution_callback = execution_callback;
                    Binance.options.margin_list_status_callback = list_status_callback;
                    const subscription = subscribe( Binance.options.listenMarginKey, userMarginDataHandler, reconnect );
                    if ( subscribed_callback ) subscribed_callback( subscription.endpoint );
                }, 'POST' );
            },

            /**
             * Subscribe to a generic websocket
             * @param {string} url - the websocket endpoint
             * @param {function} callback - optional execution callback
             * @param {boolean} reconnect - subscription callback
             * @return {WebSocket} the websocket reference
             */
            subscribe: function ( url, callback, reconnect = false ) {
                return subscribe( url, callback, reconnect );
            },

            /**
             * Subscribe to a generic combined websocket
             * @param {string} url - the websocket endpoint
             * @param {function} callback - optional execution callback
             * @param {boolean} reconnect - subscription callback
             * @return {WebSocket} the websocket reference
             */
            subscribeCombined: function ( url, callback, reconnect = false ) {
                return subscribeCombined( url, callback, reconnect );
            },

            /**
             * Returns the known websockets subscriptions
             * @return {array} array of web socket subscriptions
             */
            subscriptions: function() {
                return Binance.subscriptions;
            },

            /**
             * Terminates a web socket
             * @param {string} endpoint - the string associated with the endpoint
             * @return {undefined}
             */
            terminate: function ( endpoint ) {
                if ( Binance.options.verbose ) Binance.options.log( 'WebSocket terminating:', endpoint );
                return terminate( endpoint );
            },

            /**
             * Websocket depth chart
             * @param {array/string} symbols - an array or string of symbols to query
             * @param {function} callback - callback function
             * @return {string} the websocket endpoint
             */
            depth: function depth ( symbols, callback ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) depth( symbols, callback );
                };
                let subscription;
                if ( Array.isArray( symbols ) ) {
                    if ( !isArrayUnique( symbols ) ) throw Error( 'depth: "symbols" cannot contain duplicate elements.' );
                    let streams = symbols.map( function ( symbol ) {
                        return symbol.toLowerCase() + '@depth';
                    } );
                    subscription = subscribeCombined( streams, callback, reconnect );
                } else {
                    let symbol = symbols;
                    subscription = subscribe( symbol.toLowerCase() + '@depth', callback, reconnect );
                }
                return subscription.endpoint;
            },

            /**
             * Websocket depth cache
             * @param {array/string} symbols - an array or string of symbols to query
             * @param {function} callback - callback function
             * @param {int} limit - the number of entries
             * @return {string} the websocket endpoint
             */
            depthCache: function depthCacheFunction( symbols, callback, limit = 500 ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) depthCacheFunction( symbols, callback, limit );
                };

                let symbolDepthInit = symbol => {
                    if ( typeof Binance.depthCacheContext[symbol] === 'undefined' ) Binance.depthCacheContext[symbol] = {};
                    let context = Binance.depthCacheContext[symbol];
                    context.snapshotUpdateId = null;
                    context.lastEventUpdateId = null;
                    context.messageQueue = [];
                    Binance.depthCache[symbol] = { bids: {}, asks: {} };
                };

                let assignEndpointIdToContext = ( symbol, endpointId ) => {
                    if ( Binance.depthCacheContext[symbol] ) {
                        let context = Binance.depthCacheContext[symbol];
                        context.endpointId = endpointId;
                    }
                };

                let handleDepthStreamData = depth => {
                    let symbol = depth.s;
                    let context = Binance.depthCacheContext[symbol];
                    if ( context.messageQueue && !context.snapshotUpdateId ) {
                        context.messageQueue.push( depth );
                    } else {
                        try {
                            depthHandler( depth );
                        } catch ( err ) {
                            return terminate( context.endpointId, true );
                        }
                        if ( callback ) callback( symbol, Binance.depthCache[symbol], context );
                    }
                };

                let getSymbolDepthSnapshot = ( symbol, cb ) => {
                    publicRequest( base + 'v1/depth', { symbol: symbol, limit: limit }, function ( error, json ) {
                        if ( error ) {
                            return cb( error, null );
                        }
                        // Store symbol next use
                        json.symb = symbol;
                        cb( null, json )
                    } );
                };

                let updateSymbolDepthCache = json => {
                    // Get previous store symbol
                    let symbol = json.symb;
                    // Initialize depth cache from snapshot
                    Binance.depthCache[symbol] = depthData( json );
                    // Prepare depth cache context
                    let context = Binance.depthCacheContext[symbol];
                    context.snapshotUpdateId = json.lastUpdateId;
                    context.messageQueue = context.messageQueue.filter( depth => depth.u > context.snapshotUpdateId );
                    // Process any pending depth messages
                    for ( let depth of context.messageQueue ) {
                        /* Although sync errors shouldn't ever happen here, we catch and swallow them anyway
                         just in case. The stream handler function above will deal with broken caches. */
                        try {
                            depthHandler( depth );
                        } catch ( err ) {
                            // Do nothing
                        }
                    }
                    delete context.messageQueue;
                    if ( callback ) callback( symbol, Binance.depthCache[symbol] );
                };

                /* If an array of symbols are sent we use a combined stream connection rather.
                 This is transparent to the developer, and results in a single socket connection.
                 This essentially eliminates "unexpected response" errors when subscribing to a lot of data. */
                let subscription;
                if ( Array.isArray( symbols ) ) {
                    if ( !isArrayUnique( symbols ) ) throw Error( 'depthCache: "symbols" cannot contain duplicate elements.' );
                    symbols.forEach( symbolDepthInit );
                    let streams = symbols.map( function ( symbol ) {
                        return symbol.toLowerCase() + '@depth';
                    } );
                    subscription = subscribeCombined( streams, handleDepthStreamData, reconnect, function () {
                        async.mapLimit( symbols, 50, getSymbolDepthSnapshot, ( err, results ) => {
                            if ( err ) throw err;
                            results.forEach( updateSymbolDepthCache );
                        } );
                    } );
                    symbols.forEach( s => assignEndpointIdToContext( s, subscription.endpoint ) );
                } else {
                    let symbol = symbols;
                    symbolDepthInit( symbol );
                    subscription = subscribe( symbol.toLowerCase() + '@depth', handleDepthStreamData, reconnect, function () {
                        async.mapLimit( [symbol], 1, getSymbolDepthSnapshot, ( err, results ) => {
                            if ( err ) throw err;
                            results.forEach( updateSymbolDepthCache );
                        } );
                    } );
                    assignEndpointIdToContext( symbol, subscription.endpoint );
                }
                return subscription.endpoint;
            },

            /**
             * Clear Websocket depth cache
             * @param {String|Array} symbols   - a single symbol, or an array of symbols, to clear the cache of
             * @returns {void}
             */
            clearDepthCache( symbols ) {
                const symbolsArr = Array.isArray( symbols ) ? symbols : [symbols];
                symbolsArr.forEach( thisSymbol => {
                    delete Binance.depthCache[thisSymbol];
                } );
            },

            /**
             * Websocket staggered depth cache
             * @param {array/string} symbols - an array of symbols to query
             * @param {function} callback - callback function
             * @param {int} limit - the number of entries
             * @param {int} stagger - ms between each depth cache
             * @return {Promise} the websocket endpoint
             */
            depthCacheStaggered: function ( symbols, callback, limit = 100, stagger = 200 ) {
                if ( !Array.isArray( symbols ) ) symbols = [symbols];
                let chain = null;

                symbols.forEach( symbol => {
                    let promise = () => new Promise( resolve => {
                        this.depthCache( symbol, callback, limit );
                        setTimeout( resolve, stagger );
                    } );
                    chain = chain ? chain.then( promise ) : promise();
                } );

                return chain;
            },

            /**
             * Websocket aggregated trades
             * @param {array/string} symbols - an array or string of symbols to query
             * @param {function} callback - callback function
             * @return {string} the websocket endpoint
             */
            aggTrades: function trades( symbols, callback ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) trades( symbols, callback );
                };
                let subscription;
                if ( Array.isArray( symbols ) ) {
                    if ( !isArrayUnique( symbols ) ) throw Error( 'trades: "symbols" cannot contain duplicate elements.' );
                    let streams = symbols.map( function ( symbol ) {
                        return symbol.toLowerCase() + '@aggTrade';
                    } );
                    subscription = subscribeCombined( streams, callback, reconnect );
                } else {
                    let symbol = symbols;
                    subscription = subscribe( symbol.toLowerCase() + '@aggTrade', callback, reconnect );
                }
                return subscription.endpoint;
            },

            /**
            * Websocket raw trades
            * @param {array/string} symbols - an array or string of symbols to query
            * @param {function} callback - callback function
            * @return {string} the websocket endpoint
            */
            trades: function trades( symbols, callback ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) trades( symbols, callback );
                };

                let subscription;
                if ( Array.isArray( symbols ) ) {
                    if ( !isArrayUnique( symbols ) ) throw Error( 'trades: "symbols" cannot contain duplicate elements.' );
                    let streams = symbols.map( function ( symbol ) {
                        return symbol.toLowerCase() + '@trade';
                    } );
                    subscription = subscribeCombined( streams, callback, reconnect );
                } else {
                    let symbol = symbols;
                    subscription = subscribe( symbol.toLowerCase() + '@trade', callback, reconnect );
                }
                return subscription.endpoint;
            },

            /**
             * Websocket klines
             * @param {array/string} symbols - an array or string of symbols to query
             * @param {string} interval - the time interval
             * @param {function} callback - callback function
             * @param {int} limit - maximum results, no more than 1000
             * @return {string} the websocket endpoint
             */
            chart: function chart( symbols, interval, callback, limit = 500 ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) chart( symbols, interval, callback, limit );
                };

                let symbolChartInit = symbol => {
                    if ( typeof Binance.info[symbol] === 'undefined' ) Binance.info[symbol] = {};
                    if ( typeof Binance.info[symbol][interval] === 'undefined' ) Binance.info[symbol][interval] = {};
                    if ( typeof Binance.ohlc[symbol] === 'undefined' ) Binance.ohlc[symbol] = {};
                    if ( typeof Binance.ohlc[symbol][interval] === 'undefined' ) Binance.ohlc[symbol][interval] = {};
                    if ( typeof Binance.ohlcLatest[symbol] === 'undefined' ) Binance.ohlcLatest[symbol] = {};
                    if ( typeof Binance.ohlcLatest[symbol][interval] === 'undefined' ) Binance.ohlcLatest[symbol][interval] = {};
                    if ( typeof Binance.klineQueue[symbol] === 'undefined' ) Binance.klineQueue[symbol] = {};
                    if ( typeof Binance.klineQueue[symbol][interval] === 'undefined' ) Binance.klineQueue[symbol][interval] = [];
                    Binance.info[symbol][interval].timestamp = 0;
                }

                let handleKlineStreamData = kline => {
                    let symbol = kline.s;
                    if ( !Binance.info[symbol][interval].timestamp ) {
                        if ( typeof ( Binance.klineQueue[symbol][interval] ) !== 'undefined' && kline !== null ) {
                            Binance.klineQueue[symbol][interval].push( kline );
                        }
                    } else {
                        //Binance.options.log('@klines at ' + kline.k.t);
                        klineHandler( symbol, kline );
                        if ( callback ) callback( symbol, interval, klineConcat( symbol, interval ) );
                    }
                };

                let getSymbolKlineSnapshot = ( symbol, limit = 500 ) => {
                    publicRequest( base + 'v1/klines', { symbol: symbol, interval: interval, limit: limit }, function ( error, data ) {
                        klineData( symbol, interval, data );
                        //Binance.options.log('/klines at ' + Binance.info[symbol][interval].timestamp);
                        if ( typeof Binance.klineQueue[symbol][interval] !== 'undefined' ) {
                            for ( let kline of Binance.klineQueue[symbol][interval] ) klineHandler( symbol, kline, Binance.info[symbol][interval].timestamp );
                            delete Binance.klineQueue[symbol][interval];
                        }
                        if ( callback ) callback( symbol, interval, klineConcat( symbol, interval ) );
                    } );
                };

                let subscription;
                if ( Array.isArray( symbols ) ) {
                    if ( !isArrayUnique( symbols ) ) throw Error( 'chart: "symbols" cannot contain duplicate elements.' );
                    symbols.forEach( symbolChartInit );
                    let streams = symbols.map( function ( symbol ) {
                        return symbol.toLowerCase() + '@kline_' + interval;
                    } );
                    subscription = subscribeCombined( streams, handleKlineStreamData, reconnect );
                    symbols.forEach( element => getSymbolKlineSnapshot( element, limit ) );
                } else {
                    let symbol = symbols;
                    symbolChartInit( symbol );
                    subscription = subscribe( symbol.toLowerCase() + '@kline_' + interval, handleKlineStreamData, reconnect );
                    getSymbolKlineSnapshot( symbol, limit );
                }
                return subscription.endpoint;
            },

            /**
             * Websocket candle sticks
             * @param {array/string} symbols - an array or string of symbols to query
             * @param {string} interval - the time interval
             * @param {function} callback - callback function
             * @return {string} the websocket endpoint
             */
            candlesticks: function candlesticks( symbols, interval, callback ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) candlesticks( symbols, interval, callback );
                };

                /* If an array of symbols are sent we use a combined stream connection rather.
                 This is transparent to the developer, and results in a single socket connection.
                 This essentially eliminates "unexpected response" errors when subscribing to a lot of data. */
                let subscription;
                if ( Array.isArray( symbols ) ) {
                    if ( !isArrayUnique( symbols ) ) throw Error( 'candlesticks: "symbols" cannot contain duplicate elements.' );
                    let streams = symbols.map( function ( symbol ) {
                        return symbol.toLowerCase() + '@kline_' + interval;
                    } );
                    subscription = subscribeCombined( streams, callback, reconnect );
                } else {
                    let symbol = symbols.toLowerCase();
                    subscription = subscribe( symbol + '@kline_' + interval, callback, reconnect );
                }
                return subscription.endpoint;
            },

            /**
             * Websocket mini ticker
             * @param {function} callback - callback function
             * @return {string} the websocket endpoint
             */
            miniTicker: function miniTicker( callback ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) miniTicker( callback );
                };
                let subscription = subscribe( '!miniTicker@arr', function ( data ) {
                    let markets = {};
                    for ( let obj of data ) {
                        markets[obj.s] = {
                            close: obj.c,
                            open: obj.o,
                            high: obj.h,
                            low: obj.l,
                            volume: obj.v,
                            quoteVolume: obj.q,
                            eventTime: obj.E
                        };
                    }
                    callback( markets );
                }, reconnect );
                return subscription.endpoint;
            },

            /**
             * Websocket prevday percentage
             * @param {array/string} symbols - an array or string of symbols to query
             * @param {function} callback - callback function
             * @param {boolean} singleCallback - avoid call one callback for each symbol in data array
             * @return {string} the websocket endpoint
             */
            prevDay: function prevDay( symbols, callback, singleCallback ) {
                let reconnect = () => {
                    if ( Binance.options.reconnect ) prevDay( symbols, callback );
                };

                let subscription;
                // Combine stream for array of symbols
                if ( Array.isArray( symbols ) ) {
                    if ( !isArrayUnique( symbols ) ) throw Error( 'prevDay: "symbols" cannot contain duplicate elements.' );
                    let streams = symbols.map( function ( symbol ) {
                        return symbol.toLowerCase() + '@ticker';
                    } );
                    subscription = subscribeCombined( streams, function ( data ) {
                        prevDayStreamHandler( data, callback );
                    }, reconnect );
                    // Raw stream for  a single symbol
                } else if ( symbols ) {
                    let symbol = symbols;
                    subscription = subscribe( symbol.toLowerCase() + '@ticker', function ( data ) {
                        prevDayStreamHandler( data, callback );
                    }, reconnect );
                    // Raw stream of all listed symbols
                } else {
                    subscription = subscribe( '!ticker@arr', function ( data ) {
                        if ( singleCallback ) {
                            prevDayStreamHandler( data, callback );
                        } else {
                            for ( let line of data ) {
                                prevDayStreamHandler( line, callback );
                            }
                        }
                    }, reconnect );
                }
                return subscription.endpoint;
            }
        }
    };
}
function instanceWrapper( options = {} ) {
    if ( new.target ) return api( options );
    return new api( options );
}
module.exports = instanceWrapper;
//https://github.com/binance-exchange/binance-official-api-docs
