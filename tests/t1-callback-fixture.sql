CREATE TABLE dbo.A_TaskManager_Tasks(Id uniqueidentifier,ListId uniqueidentifier);
CREATE TABLE dbo.A_Users(Id uniqueidentifier PRIMARY KEY,Enabled bit,IsDeleted bit);
CREATE TABLE dbo.A_UserParams(IdUser uniqueidentifier,IsOperator bit);
CREATE TABLE dbo.A_UserStateHistory(UserId uniqueidentifier,State int,Enumerator bigint);
CREATE TABLE dbo.A_TaskManager_Operators(TaskId uniqueidentifier,OperatorId uniqueidentifier,IsGroup bit);
CREATE TABLE dbo.A_TaskManager_SubTaskEfforts(Id uniqueidentifier,TaskId uniqueidentifier,ConnectionChainId uniqueidentifier,IdInList int,Number varchar(32),EResult int,EDateTime datetime);
CREATE TABLE dbo.A_TaskManager_SubTasks(TaskId uniqueidentifier,IdInList int,NextEffortTime datetime,NResult int,IsDeleted int);
CREATE TABLE dbo.A_TaskManager_SubTaskNumber(TaskId uniqueidentifier,IdInList int,Number varchar(32),NextEffortTime datetime,NResult int);
CREATE TABLE dbo.FixtureContacts(ListId uniqueidentifier,Id int,Phone varchar(32));
CREATE TABLE dbo.CRM_T1TimeCursor(ListId uniqueidentifier PRIMARY KEY,LastId int NOT NULL);
GO
CREATE FUNCTION dbo.CRM_T1TimeCandidates(@list uniqueidentifier) RETURNS TABLE AS RETURN SELECT Id,Phone FROM dbo.FixtureContacts WHERE ListId=@list;
GO
CREATE PROCEDURE dbo.CRM_T1_Select AS SELECT 1;
GO
CREATE PROCEDURE dbo.A_TaskManager_OperatorsAll_Get_Custom AS SELECT 1;
GO
