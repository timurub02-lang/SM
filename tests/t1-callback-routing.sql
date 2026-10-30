SET NOCOUNT ON;
DECLARE @task uniqueidentifier='185e121d-d888-4598-85d2-00aa47c825c5',@list uniqueidentifier=NEWID(),
 @owner uniqueidentifier=NEWID(),@other uniqueidentifier=NEWID(),@chain uniqueidentifier=NEWID(),@cmd uniqueidentifier=NEWID(),
 @now datetime2='2026-10-30T09:00:00',@id nvarchar(40),@phone nvarchar(32);
INSERT dbo.A_TaskManager_Tasks VALUES(@task,@list);
INSERT dbo.A_Users VALUES(@owner,1,0),(@other,1,0);
INSERT dbo.A_UserParams VALUES(@owner,1),(@other,1);
INSERT dbo.A_TaskManager_Operators VALUES(@task,@owner,0),(@task,@other,0);
INSERT dbo.A_UserStateHistory VALUES(@owner,1,1),(@other,1,2);
INSERT dbo.FixtureContacts VALUES(@list,1,'79990000001'),(@list,2,'79990000002'),(@list,3,'79990000003');
INSERT dbo.CRM_PhoneTimeRanges VALUES(79990000000,79990000009,180,180);
INSERT dbo.CRM_PhoneTimeRegistry VALUES(1,'2026-01-01','2027-01-01','fixture');
INSERT dbo.CRM_CallTimePolicies VALUES(@task,540,1200);
INSERT dbo.CRM_CallTimeSchedule VALUES(@task,5,540,1200);
INSERT dbo.A_TaskManager_SubTasks VALUES(@task,1,'2026-10-30T11:55:00',0,0),(@task,2,NULL,0,0),(@task,3,'2026-10-30T11:58:00',0,0);
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,@chain,1,'79990000001',8,'2026-10-30T11:00:00');
-- Missing owner sync blocks this callback but leaves another due contact selectable.
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'3' THROW 51100,'Unconfirmed callback was selected or priority lost',1;
DELETE dbo.CRM_T1SelectionOffers;
EXEC dbo.w_crm_t1_callback_sync @cmd,@chain,@task,@list,@owner,'79990000001','2026-10-30T11:55:00+03:00';
EXEC dbo.w_crm_t1_callback_sync @cmd,@chain,@task,@list,@owner,'79990000001','2026-10-30T08:55:00Z';
IF (SELECT COUNT(*) FROM dbo.CRM_T1CallbackResults)<>1 THROW 51100,'Idempotency failed',1;
BEGIN TRY
 EXEC dbo.w_crm_t1_callback_sync @cmd,@chain,@task,@list,@other,'79990000001','2026-10-30T08:55:00Z';
 THROW 51100,'Conflicting owner accepted',1;
END TRY BEGIN CATCH IF ERROR_NUMBER()<>51012 THROW; END CATCH;
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'1' THROW 51100,'Original due priority lost',1;
DECLARE @operators TABLE(Id uniqueidentifier);
INSERT @operators EXEC dbo.A_TaskManager_OperatorsAll_Get_Custom @task,@list,1;
IF (SELECT COUNT(*) FROM @operators)<>1 OR NOT EXISTS(SELECT 1 FROM @operators WHERE Id=@owner) THROW 51100,'Owner affinity lost',1;
-- Offline owner does not stall other contacts, and is not replaced before 30 minutes.
INSERT dbo.A_UserStateHistory VALUES(@owner,0,3);
DELETE dbo.CRM_T1SelectionOffers;
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'3' THROW 51100,'Offline callback stalled the queue',1;
DELETE @operators;
INSERT @operators EXEC dbo.A_TaskManager_OperatorsAll_Get_Custom @task,@list,1;
IF EXISTS(SELECT 1 FROM @operators) THROW 51100,'Owner replaced too early',1;
-- Busy/no answer changes only the native retry time, never the original callback due.
INSERT dbo.A_TaskManager_SubTaskNumber VALUES(@task,1,'79990000001','2026-10-30T12:10:00',0);
UPDATE dbo.CRM_T1CallbackResults SET DueUtc='2026-10-30T08:30:00';
DELETE dbo.CRM_T1SelectionOffers;
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'3' THROW 51100,'Future native retry was bypassed',1;
IF NOT EXISTS(SELECT 1 FROM dbo.CRM_T1CallbackResults WHERE Released=1) THROW 51100,'30 minute release missing',1;
UPDATE dbo.A_TaskManager_SubTaskNumber SET NextEffortTime='2026-10-30T11:59:00';
DELETE dbo.CRM_T1SelectionOffers;
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'1' THROW 51100,'Overdue callback not first after retry delay',1;
INSERT dbo.A_UserStateHistory VALUES(@owner,1,4);
DELETE @operators;
INSERT @operators EXEC dbo.A_TaskManager_OperatorsAll_Get_Custom @task,@list,1;
IF (SELECT COUNT(*) FROM @operators)<>2 THROW 51100,'Released callback was rebound',1;
-- A subsequent terminal result clears affinity, even when the earlier callback exists in native history.
DECLARE @terminal uniqueidentifier=NEWID(),@terminalCommand uniqueidentifier=NEWID();
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,@terminal,1,'79990000001',1,'2026-10-30T11:59:00');
EXEC dbo.w_crm_t1_callback_sync @terminalCommand,@terminal,@task,@list,@other,'79990000001',NULL;
IF NOT EXISTS(SELECT 1 FROM dbo.CRM_T1CallbackState(@list,1,'79990000001',@now) WHERE Eligible=1 AND OwnerOnly=0 AND DueUtc IS NULL) THROW 51100,'Terminal result did not clear affinity',1;
-- A newer native callback cannot reuse an old owner's registry entry.
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,NEWID(),1,'79990000001',8,'2026-10-30T12:00:00');
IF EXISTS(SELECT 1 FROM dbo.CRM_T1CallbackState(@list,1,'79990000001',@now) WHERE Eligible=1) THROW 51100,'New callback inherited stale owner',1;
-- Resetting native history must not resurrect an old registry binding.
DELETE dbo.A_TaskManager_SubTaskEfforts;
IF NOT EXISTS(SELECT 1 FROM dbo.CRM_T1CallbackState(@list,1,'79990000001',@now) WHERE Eligible=1 AND OwnerOnly=0 AND DueUtc IS NULL) THROW 51100,'Reset resurrected old callback',1;
-- A callback with missing native chain is blocked for reconciliation.
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,NULL,1,'79990000001',8,'2026-10-30T12:00:00');
IF EXISTS(SELECT 1 FROM dbo.CRM_T1CallbackState(@list,1,'79990000001',@now) WHERE Eligible=1) THROW 51100,'Uncorrelated native callback escaped',1;
-- Cross-product: owner availability/expiry and project/client windows, native due, completion.
DECLARE @offset int=120,@minute int,@ready bit,@age int,@cases int=0;
WHILE @offset<=720 BEGIN
 UPDATE dbo.CRM_PhoneTimeRanges SET MinOffset=@offset,MaxOffset=@offset;
 SET @minute=0;
 WHILE @minute<1440 BEGIN
  SET @ready=0;
  WHILE 1=1 BEGIN
   SET @age=-1;
   WHILE @age<=31 BEGIN
    DECLARE @utc datetime2=DATEADD(minute,@minute,CONVERT(datetime2,'2026-10-30'));
    DECLARE @local datetime2=DATEADD(minute,180,@utc),@due datetime2=DATEADD(minute,-@age,@utc);
    DECLARE @timeExpected bit=CASE WHEN (@minute+180)%1440 BETWEEN 540 AND 1199 AND (@minute+@offset)%1440 BETWEEN 540 AND 1199 THEN 1 ELSE 0 END;
    DECLARE @ownerExpected bit=CASE WHEN @age>=0 AND (@ready=1 OR @age>=30) THEN 1 ELSE 0 END;
    IF NOT EXISTS(SELECT 1 FROM dbo.CRM_T1CandidateTiming(@utc,@local,'79990000001',DATEADD(minute,-1,@local),NULL,0,0,0) t
     CROSS APPLY dbo.CRM_T1Affinity(@utc,@due,0,@ready,0) a WHERE CONVERT(int,t.Eligible)*CONVERT(int,a.Eligible)=CONVERT(int,@timeExpected)*CONVERT(int,@ownerExpected)) THROW 51100,'Combined time/affinity matrix failed',1;
    IF EXISTS(SELECT 1 FROM dbo.CRM_T1CandidateTiming(@utc,@local,'79990000001',DATEADD(minute,1,@local),NULL,0,0,0) WHERE Eligible=1) THROW 51100,'Future retry allowed',1;
    SET @cases+=1; SET @age+=1;
   END;
   IF @ready=1 BREAK; SET @ready=1;
  END;
  SET @minute+=30;
 END;
 SET @offset+=60;
END;
UPDATE dbo.CRM_PhoneTimeRegistry SET ValidUntil='2026-01-02';
IF EXISTS(SELECT 1 FROM dbo.CRM_T1CandidateTiming(@now,DATEADD(hour,3,@now),'79990000001',NULL,NULL,0,0,0) WHERE Eligible=1) THROW 51100,'Stale timezone registry allowed',1;
PRINT CONCAT('PASS: native SQL callback routing, priority, retry, permanent release and ',@cases,' combined window/owner cases');

