FROM php:8.3-cli
WORKDIR /app
RUN docker-php-ext-install curl
COPY index.php .
CMD ["php", "-S", "0.0.0.0:3000", "index.php"]
