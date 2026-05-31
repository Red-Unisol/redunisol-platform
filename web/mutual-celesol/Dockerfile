FROM php:8.3-apache

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libonig-dev \
    && docker-php-ext-install mbstring opcache \
    && a2enmod headers rewrite \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html

COPY docker/apache/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY public /var/www/html/public

RUN chown -R www-data:www-data /var/www/html/public

EXPOSE 80
