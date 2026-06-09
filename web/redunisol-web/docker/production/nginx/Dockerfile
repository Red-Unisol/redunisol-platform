# Stage 1: Build assets in a Laravel-capable environment.
FROM php:8.4-cli AS builder

# Install PHP extension dependencies, Node.js, and Composer prerequisites.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    unzip \
    nodejs \
    npm \
    libpq-dev \
    libonig-dev \
    libssl-dev \
    libxml2-dev \
    libcurl4-openssl-dev \
    libicu-dev \
    libzip-dev \
    libpng-dev \
    libjpeg62-turbo-dev \
    libfreetype6-dev \
    libwebp-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) \
    pdo_mysql \
    pdo_pgsql \
    pgsql \
    intl \
    zip \
    bcmath \
    soap \
    gd \
    && apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer

# Set working directory
WORKDIR /var/www

# Copy Laravel application code
COPY . /var/www

# Install PHP and Node.js dependencies, then build assets.
ARG VITE_TRACKING_DEBUG=
ARG VITE_GA4_DEBUG=
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-progress --prefer-dist \
    && npm install \
    && npm run build

# Stage 2: Nginx production image
FROM nginx:alpine

# Copy custom Nginx configuration
# -----------------------------------------------------------
# Replace the default Nginx configuration with our custom one
# that is optimized for serving a Laravel application.
# -----------------------------------------------------------
COPY ./docker/production/nginx/nginx.conf /etc/nginx/nginx.conf

# Copy Laravel's public assets from the builder stage
# -----------------------------------------------------------
# We only need the 'public' directory from our Laravel app.
# -----------------------------------------------------------
COPY --from=builder /var/www/public /var/www/public

# Match Laravel's public storage path to the runtime storage volume mounted by Compose.
RUN if [ ! -e /var/www/public/storage ]; then ln -s /var/www/storage/app/public /var/www/public/storage; fi

# Set the working directory to the public folder
WORKDIR /var/www/public

# Expose port 80 and start Nginx
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
