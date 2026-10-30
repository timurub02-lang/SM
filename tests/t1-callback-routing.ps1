$ErrorActionPreference='Stop'
# This test accepts no server parameter: all A_* fixture writes stay in a disposable local DB.
$dbName='CallbackFixture_'+[guid]::NewGuid().ToString('N')
$c=New-Object System.Data.SqlClient.SqlConnection 'Server=(localdb)\MSSQLLocalDB;Integrated Security=True;Database=master'
$c.Open()
function Sql([string]$text) {
 foreach($batch in [regex]::Split($text,'(?im)^GO\s*$')) {
  if(-not $batch.Trim()){continue}
  $q=$c.CreateCommand();$q.CommandTimeout=180;$q.CommandText=$batch
  try{[void]$q.ExecuteNonQuery()}finally{$q.Dispose()}
 }
}
$c.add_InfoMessage({param($sender,$event) Write-Host $event.Message})
try {
 Sql "CREATE DATABASE [$dbName]"; $c.ChangeDatabase($dbName)
 Sql (Get-Content -Raw "$PSScriptRoot/t1-callback-fixture.sql")
 Sql (Get-Content -Raw "$PSScriptRoot/t1-callback-dependencies.sql")
 $routing=Get-Content -Raw "$PSScriptRoot/../scripts/oktell-bridge/sql/t1-callback-routing.sql"
 # Only clocks and cross-database references are substituted in the isolated fixture.
 $routing=$routing.Replace('oktell_settings.dbo.','dbo.').Replace('SYSUTCDATETIME()',"CONVERT(datetime2,'2026-10-30T09:00:00')").Replace('SYSDATETIME()',"CONVERT(datetime2,'2026-10-30T12:00:00')")
 Sql $routing
 Sql (Get-Content -Raw "$PSScriptRoot/t1-callback-routing.sql")
 $attemptOrder=Get-Content -Raw "$PSScriptRoot/../scripts/oktell-bridge/sql/t1-attempt-order.sql"
 $attemptOrder=$attemptOrder.Replace('oktell_settings.dbo.','dbo.').Replace('SYSUTCDATETIME()',"CONVERT(datetime2,'2026-10-30T09:00:00')").Replace('SYSDATETIME()',"CONVERT(datetime2,'2026-10-30T12:00:00')")
 Sql $attemptOrder
 Sql (Get-Content -Raw "$PSScriptRoot/t1-attempt-order.sql")
 if(([version]$c.ServerVersion).Major -ge 13) {
 Sql 'ALTER TABLE dbo.A_TaskManager_Tasks ADD Active int,Done int,Name nvarchar(100); CREATE TABLE dbo.A_TaskManager_Lists(Id uniqueidentifier,Type int,Query nvarchar(1000)); CREATE TABLE dbo.A_SessionStorage(Id int);'
 $delivery=(Get-Content -Raw "$PSScriptRoot/../scripts/oktell-bridge/delivery-schema.sql").Replace('oktell_settings.dbo.','dbo.')
 Sql $delivery
 Sql (Get-Content -Raw "$PSScriptRoot/t1-delivery-identity.sql")
 Sql 'CREATE TABLE dbo.[A_TaskManager_LocalList_4a10515d-518d-463e-bfe8-f0ca3ce11d7d_0](Id int,phone varchar(32));'
 Sql (Get-Content -Raw "$PSScriptRoot/../scripts/oktell-bridge/sql/t1-delivery-source.sql")
 Sql "IF (SELECT COUNT(*) FROM dbo.crm_t1_delivery)<>1 OR (SELECT COUNT(*) FROM dbo.CRM_T1TimeCandidates('fd519550-95d8-45c3-9fb9-be83f3084034'))<>1 THROW 51300,'Archived contacts leaked into the native source',1;"

 } elseif($env:CI) { throw 'Delivery fixtures require SQL Server 2016 or newer' }
 else { Write-Host 'SKIP local delivery JSON fixture: SQL Server 2014; mandatory on GitHub modern LocalDB' }

} finally {
 $c.ChangeDatabase('master');Sql "ALTER DATABASE [$dbName] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [$dbName]"; $c.Close()
}
