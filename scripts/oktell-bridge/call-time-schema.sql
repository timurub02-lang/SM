-- Separate Oktell installation artifact. CRM-owned tables only; never writes A_*.
IF OBJECT_ID('dbo.CRM_PhoneTimeRanges') IS NULL
 CREATE TABLE dbo.CRM_PhoneTimeRanges(StartNumber bigint NOT NULL PRIMARY KEY,EndNumber bigint NOT NULL,MinOffset int NULL,MaxOffset int NULL,
 CHECK(StartNumber<=EndNumber),CHECK((MinOffset IS NULL AND MaxOffset IS NULL) OR (MinOffset BETWEEN 120 AND 720 AND MaxOffset BETWEEN MinOffset AND 720)));
IF OBJECT_ID('dbo.CRM_PhoneTimeRegistry') IS NULL
 CREATE TABLE dbo.CRM_PhoneTimeRegistry(Id int NOT NULL PRIMARY KEY CHECK(Id=1),AsOf datetime2 NOT NULL,ValidUntil datetime2 NOT NULL,Hash varchar(64) NOT NULL);
IF OBJECT_ID('dbo.CRM_CallTimePolicies') IS NULL
 CREATE TABLE dbo.CRM_CallTimePolicies(TaskId uniqueidentifier PRIMARY KEY,ClientFrom int NOT NULL,ClientTo int NOT NULL,
 CHECK(ClientFrom>=0 AND ClientFrom<ClientTo AND ClientTo<=1440));
IF OBJECT_ID('dbo.CRM_CallTimeSchedule') IS NULL
 CREATE TABLE dbo.CRM_CallTimeSchedule(TaskId uniqueidentifier NOT NULL,DayNumber int NOT NULL,FromMinute int NOT NULL,ToMinute int NOT NULL,
 PRIMARY KEY(TaskId,DayNumber,FromMinute),CHECK(DayNumber BETWEEN 1 AND 7),CHECK(FromMinute>=0 AND FromMinute<ToMinute AND ToMinute<=1440));
GO
CREATE OR ALTER FUNCTION dbo.CRM_CallTimeDecision(@task uniqueidentifier,@phone varchar(32),@utc datetime2)
RETURNS TABLE AS RETURN
WITH rangeMatch AS (
 SELECT TOP(1) * FROM dbo.CRM_PhoneTimeRanges WHERE StartNumber<=TRY_CONVERT(bigint,@phone) ORDER BY StartNumber DESC
), times AS (
 SELECT r.*,DATEADD(minute,r.MinOffset,@utc) Earliest,DATEADD(minute,r.MaxOffset,@utc) Latest,DATEADD(minute,180,@utc) Moscow FROM rangeMatch r
), decision AS (
 SELECT CASE
 WHEN LEN(@phone)<>11 OR @phone NOT LIKE '7%' OR @phone LIKE '%[^0-9]%' OR @phone IS NULL THEN 'timezone_invalid'
 WHEN @utc IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.CRM_PhoneTimeRegistry WHERE Id=1 AND @utc>=AsOf AND @utc<ValidUntil) THEN 'timezone_stale'
 WHEN NOT EXISTS(SELECT 1 FROM times WHERE TRY_CONVERT(bigint,@phone)<=EndNumber AND MinOffset IS NOT NULL) THEN 'timezone_unknown'
 WHEN NOT EXISTS(SELECT 1 FROM dbo.CRM_CallTimePolicies WHERE TaskId=@task) THEN 'invalid_policy'
 WHEN NOT EXISTS(SELECT 1 FROM times t JOIN dbo.CRM_CallTimeSchedule s ON s.TaskId=@task
  AND s.DayNumber=((DATEDIFF(day,CONVERT(date,'19000101'),t.Moscow)%7+7)%7)+1
  AND DATEPART(hour,t.Moscow)*60+DATEPART(minute,t.Moscow)>=s.FromMinute
  AND DATEPART(hour,t.Moscow)*60+DATEPART(minute,t.Moscow)<s.ToMinute) THEN 'project_closed'
 WHEN NOT EXISTS(SELECT 1 FROM times t JOIN dbo.CRM_CallTimePolicies p ON p.TaskId=@task
  AND DATEPART(hour,t.Earliest)*60+DATEPART(minute,t.Earliest)>=p.ClientFrom
  AND DATEPART(hour,t.Earliest)*60+DATEPART(minute,t.Earliest)<p.ClientTo
  AND DATEPART(hour,t.Latest)*60+DATEPART(minute,t.Latest)>=p.ClientFrom
  AND DATEPART(hour,t.Latest)*60+DATEPART(minute,t.Latest)<p.ClientTo) THEN 'client_closed'
 ELSE 'allowed' END Reason
)
SELECT CONVERT(bit,CASE WHEN Reason='allowed' THEN 1 ELSE 0 END) Allowed,Reason FROM decision;
GO
CREATE OR ALTER PROCEDURE dbo.w_crm_t1_time_gate @task uniqueidentifier,@id int,@phone varchar(32)
AS
BEGIN
 SET NOCOUNT ON;
 -- The clock is taken at the dial boundary, never from a browser or an import timestamp.
 IF NOT EXISTS(SELECT 1 FROM dbo.CRM_DeliveryContacts c JOIN dbo.CRM_DeliveryReceipts r ON r.BatchId=c.BatchId
  WHERE c.TaskId=@task AND c.Id=@id AND c.Phone=@phone AND r.TaskId=@task AND r.Cancelled=0)
 BEGIN SELECT CONVERT(bit,0) Allowed,'contact_mismatch' Reason;RETURN;END;
 SELECT Allowed,Reason FROM dbo.CRM_CallTimeDecision(@task,@phone,SYSUTCDATETIME());
END;
GO
