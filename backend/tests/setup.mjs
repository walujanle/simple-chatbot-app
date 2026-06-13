process.env.JWT_SECRET = "0123456789abcdef0123456789abcdef";
process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.from(Array.from({ length: 32 }, (_, index) => index)).toString("base64");
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.DATABASE_URL = "";
