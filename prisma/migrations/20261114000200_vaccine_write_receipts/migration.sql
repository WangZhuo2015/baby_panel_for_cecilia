CREATE TABLE "VaccineWriteReceipt" (
  "babyId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("babyId", "clientId"),
  CONSTRAINT "VaccineWriteReceipt_babyId_fkey" FOREIGN KEY ("babyId") REFERENCES "Baby" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
