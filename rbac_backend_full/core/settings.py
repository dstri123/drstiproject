import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# Load local secrets (e.g. SMTP credentials) from rbac_backend_full/.env if present.
try:
    from dotenv import load_dotenv
    # override=True: runserver's autoreloader starts each worker with the
    # parent's os.environ, so without it a value captured at first start
    # (e.g. an empty EMAIL_HOST_PASSWORD) would shadow later .env edits.
    load_dotenv(BASE_DIR / ".env", override=True)
except ImportError:
    pass

SECRET_KEY = 'test'
DEBUG = True
ALLOWED_HOSTS = []

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'rest_framework',
    'corsheaders',
    'drf_spectacular',

    'accounts',
    'projects',
    'processing',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'core.middleware.DisableCOEPMiddleware',

    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',

    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',

    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': 'distriapp',
        'USER': 'root',
        'PASSWORD': '2000',
        'HOST': '127.0.0.1',
        'PORT': '3306',
    }
}

STATIC_URL = 'static/'

ROOT_URLCONF = 'core.urls'

CORS_ALLOW_ALL_ORIGINS = True

# Disable COEP for development (allows cross-origin images)
SECURE_CROSS_ORIGIN_OPENER_POLICY = None
SECURE_CROSS_ORIGIN_EMBEDDER_POLICY = None

# Allow images to be loaded from cross-origin
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

AUTH_USER_MODEL = 'accounts.User'

from datetime import timedelta

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    # Require authentication by default so a view that forgets to declare
    # permission_classes is NOT silently public. Truly public endpoints
    # (login/signup/check-admin/create-admin) opt out with AllowAny.
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
}

SPECTACULAR_SETTINGS = {
    'TITLE': 'RBAC Distribution API',
    'DESCRIPTION': 'Complete REST API for Role-Based Access Control with Project & Data Management',
    'VERSION': '1.0.0',
    'SERVE_PERMISSIONS': ['rest_framework.permissions.AllowAny'],
    'SERVE_INCLUDE_SCHEMA': False,
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(days=7),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'ROTATE_REFRESH_TOKENS': False,
    'BLACKLIST_AFTER_ROTATION': False,
}

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DIR, "media")

# Email — used for password reset codes. Put SMTP credentials in
# rbac_backend_full/.env (see .env.example). Without EMAIL_HOST_USER and
# EMAIL_HOST_PASSWORD, emails
# are only printed in the runserver console.
EMAIL_HOST = os.environ.get("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "").replace(" ", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "true").lower() == "true"
EMAIL_TIMEOUT = 15
EMAIL_BACKEND = os.environ.get(
    "EMAIL_BACKEND",
    "django.core.mail.backends.smtp.EmailBackend"
    if EMAIL_HOST_USER and EMAIL_HOST_PASSWORD
    else "django.core.mail.backends.console.EmailBackend",
)
DEFAULT_FROM_EMAIL = os.environ.get(
    "DEFAULT_FROM_EMAIL", f"C Twin <{EMAIL_HOST_USER}>" if EMAIL_HOST_USER else "C Twin <no-reply@drsti.local>"
)
