SET NOCOUNT ON;
UPDATE dbo.CRM_PhoneTimeRegistry SET ValidUntil='2027-01-01';
DELETE dbo.A_TaskManager_SubTaskEfforts;
DELETE dbo.A_TaskManager_SubTasks;
DELETE dbo.A_TaskManager_SubTaskNumber;
DELETE dbo.CRM_T1CallbackResults;
DELETE dbo.CRM_T1SelectionOffers;
DELETE dbo.CRM_T1TimeCursor;
DELETE dbo.FixtureContacts;
UPDATE dbo.CRM_PhoneTimeRanges SET MinOffset=180,MaxOffset=180;
UPDATE dbo.CRM_CallTimeSchedule SET FromMinute=540,ToMinute=1200;
DECLARE @task uniqueidentifier='185e121d-d888-4598-85d2-00aa47c825c5',
 @list uniqueidentifier=(SELECT ListId FROM dbo.A_TaskManager_Tasks),@id nvarchar(40),@phone nvarchar(32),
 @owner uniqueidentifier=(SELECT TOP(1) Id FROM dbo.A_Users),@chain uniqueidentifier=NEWID(),@command uniqueidentifier=NEWID();
INSERT dbo.FixtureContacts VALUES(@list,1,'79990000001'),(@list,2,'79990000002'),(@list,3,'79990000003');
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,NEWID(),1,'79990000001',2,'2026-10-30T10:00:00');
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,NEWID(),1,'79990000001',3,'2026-10-30T11:00:00');
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,NEWID(),2,'79990000002',2,'2026-10-30T11:00:00');
-- A normal retry timestamp must not promote that contact over untouched clients.
INSERT dbo.A_TaskManager_SubTaskNumber VALUES(@task,1,'79990000001','2026-10-30T11:30:00',0);
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'3' THROW 51200,'Ordinary attempts must be ordered 0 then 1 then 2',1;
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'2' THROW 51200,'One-attempt contact must precede two-attempt contact',1;
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'1' THROW 51200,'Two attempts must remain eligible',1;
DELETE dbo.CRM_T1SelectionOffers;
-- Third failure without a connection chain still consumes an attempt.
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,NULL,1,'79990000001',1,'2026-10-30T11:45:00');
INSERT dbo.A_TaskManager_SubTasks VALUES(@task,2,NULL,1,0),(@task,3,NULL,1,0);
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'' THROW 51200,'Global three-attempt limit was bypassed',1;
-- A due confirmed callback precedes a fresh contact; an unavailable owner does not stall it.
DELETE dbo.A_TaskManager_SubTasks WHERE IdInList=3;
INSERT dbo.A_TaskManager_SubTaskEfforts VALUES(NEWID(),@task,@chain,2,'79990000002',8,'2026-10-30T11:30:00');
DELETE dbo.A_TaskManager_SubTasks WHERE IdInList=2;
INSERT dbo.A_UserStateHistory VALUES(@owner,1,1000000);
EXEC dbo.w_crm_t1_callback_sync @command,@chain,@task,@list,@owner,'79990000002','2026-10-30T08:55:00Z';
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'2' THROW 51200,'Due callback lost priority to a fresh contact',1;
DELETE dbo.CRM_T1SelectionOffers;
INSERT dbo.A_UserStateHistory VALUES(@owner,0,1000001);
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'3' THROW 51200,'Unavailable callback owner stalled fresh contacts',1;
DELETE dbo.CRM_T1SelectionOffers;
INSERT dbo.A_UserStateHistory VALUES(@owner,1,1000002);
INSERT dbo.A_TaskManager_SubTaskNumber VALUES(@task,2,'79990000002','2026-10-30T12:10:00',0);
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'3' THROW 51200,'Callback bypassed native retry delay',1;
DELETE dbo.CRM_T1SelectionOffers;
UPDATE dbo.CRM_CallTimePolicies SET ClientFrom=780;
EXEC dbo.CRM_T1_Select @list,@id OUTPUT,@phone OUTPUT;
IF @id<>'' THROW 51200,'Attempt ordering bypassed client timezone',1;
PRINT 'PASS: attempt order, retry vs callback priority, aggregate cap, owner and time windows';
