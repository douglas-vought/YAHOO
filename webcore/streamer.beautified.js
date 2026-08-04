/*
  Beautified and annotated version (focused) of webcore/streamer.js
  - purpose: show how the main thread creates the worker, passes ports,
    and calls subscribe/unsubscribe.
  - This is a partial reformat emphasizing the public API and message flow.
*/

// Note: this file is a formatted/annotated extraction of the original bundle
// webcore/streamer.js. It does not aim to be a drop-in replacement but to
// highlight the runtime shape: creating worker, MessageChannel ports, and
// commands (init, subscribe, unsubscribe, destroy).

(function () {
  'use strict';

  // Worker path in the original page: webcore/streamer.worker.hash.worker.js
  const WORKER_PATH = './webcore/streamer.worker.hash.worker.js';

  // Create a singleton StreamerClient that talks to the worker via postMessage
  class StreamerClient {
    constructor(options = {}) {
      this.worker = null;
      this.port = null; // MessagePort for two-way comms
      this.useStaging = !!options.useStaging;
    }

    init() {
      // Create a worker and a MessageChannel; send one port to worker
      this.worker = new Worker(WORKER_PATH);
      const mc = new MessageChannel();
      this.port = mc.port1;
      // Send port2 to worker along with init command
      this.worker.postMessage({ cmd: 'init', useStagingStreamer: this.useStaging }, [mc.port2]);

      // Listen for messages from the worker
      this.port.onmessage = (ev) => {
        const data = ev.data;
        switch (data.cmd) {
          case 'connected':
            console.log('Streamer connected');
            break;
          case 'error':
            console.error('Streamer error:', data.message);
            break;
          default:
            // For subscriber messages (quote/polymarket/earnings), the worker posts
            // objects like { subscriberType: 'quote', quoteData: { ... } }
            // Forward them into the application event bus or handlers.
            this.handleWorkerMessage(data);
        }
      };
    }

    handleWorkerMessage(msg) {
      // Application-specific: publish to UI, charts, portfolio, etc.
      // Example: if (msg.subscriberType === 'quote') updateQuoteUI(msg.quoteData)
      // Here we simply log for inspection.
      console.debug('Worker -> main:', msg);
    }

    subscribeQuotes(symbols, fields = [], crumb = '') {
      // send subscribe command over port to worker
      this.port.postMessage({ cmd: 'subscribe', data: { subscriberType: 'quote', symbols, fields, crumb } });
    }

    unsubscribeQuotes(symbols, fields = [], crumb = '') {
      this.port.postMessage({ cmd: 'unsubscribe', data: { subscriberType: 'quote', symbols, fields, crumb } });
    }

    destroy() {
      this.port.postMessage({ cmd: 'destroy' });
      this.port.close();
      this.worker.terminate();
      this.worker = null;
      this.port = null;
    }
  }

  // Export for application usage (UMD/commonjs not added here for brevity)
  window.__FinanceStreamerClient = StreamerClient;
})();
