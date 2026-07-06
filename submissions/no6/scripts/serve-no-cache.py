#!/usr/bin/env python3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
import sys

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

if __name__ == '__main__':
    directory = sys.argv[1] if len(sys.argv) > 1 else '.'
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 8878
    httpd = ThreadingHTTPServer(('0.0.0.0', port), partial(NoCache, directory=directory))
    print(f'serving {directory} on 0.0.0.0:{port} no-cache', flush=True)
    httpd.serve_forever()
