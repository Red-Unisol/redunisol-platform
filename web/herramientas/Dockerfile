FROM composer:2 AS vendor

WORKDIR /app

COPY composer.json composer.lock ./

RUN composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction --no-scripts

COPY . .

FROM node:22-alpine AS frontend

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY resources ./resources
COPY public ./public
COPY vite.config.js ./vite.config.js

RUN npm run build

FROM php:8.4-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip libzip-dev libonig-dev libsqlite3-dev \
    && docker-php-ext-install fileinfo mbstring opcache zip pdo_sqlite \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

COPY docker/apache/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY --from=vendor /app /var/www/html
COPY --from=frontend /app/public/build /var/www/html/public/build

RUN cp .env.example .env \
    && mkdir -p storage/logs storage/framework/cache storage/framework/sessions storage/framework/views storage/app/private/padrones bootstrap/cache \
    && chown -R www-data:www-data storage bootstrap/cache

EXPOSE 80

COPY docker/php-padrones.ini /usr/local/etc/php/conf.d/padrones.ini
