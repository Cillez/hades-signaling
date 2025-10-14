FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --only=production

# Copy source
COPY dist ./dist

# Expose port
EXPOSE 3002

# Start server
CMD ["node", "dist/index.js"]

