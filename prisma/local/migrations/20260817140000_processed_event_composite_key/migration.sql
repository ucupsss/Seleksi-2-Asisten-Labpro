-- The same event is delivered independently to each relying application.
-- Its idempotency record must therefore be unique within an application.
ALTER TABLE "ProcessedEvent"
DROP CONSTRAINT "ProcessedEvent_pkey",
ADD CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("appKey", "eventId");
