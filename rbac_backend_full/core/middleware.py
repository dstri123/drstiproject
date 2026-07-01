class DisableCOEPMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Remove COEP headers to allow cross-origin image loading
        if 'Cross-Origin-Embedder-Policy' in response:
            del response['Cross-Origin-Embedder-Policy']

        # Add CORS headers for media files
        response['Cross-Origin-Resource-Policy'] = 'cross-origin'
        response['Access-Control-Allow-Origin'] = '*'

        return response
