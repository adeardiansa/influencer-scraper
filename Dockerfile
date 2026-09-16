FROM node:20

WORKDIR /app

# Copy package info and install dependencies
COPY package*.json ./
RUN npm install

# Install Playwright chromium with its dependencies (OS libraries)
RUN npx playwright install --with-deps chromium

# Copy all other project files
COPY . .

# Berikan akses penuh ke folder /app agar server bisa menulis/menyimpan file hasil scraping (.json & .csv)
# (Hugging Face menjalankan container sebagai user non-root demi keamanan)
RUN chmod -R 777 /app

# Hugging Face menggunakan port 7860 secara default
EXPOSE 7860

CMD ["npm", "start"]
