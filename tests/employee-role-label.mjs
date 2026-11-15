import assert from 'node:assert/strict';
import {employeeRoleGroup,employeeRoleLabel} from '../lib/employee-role-label.ts';
const emil={login:'A_Emil',role:'department_head'},head={login:'A_Alena',role:'department_head'};
assert.equal(employeeRoleGroup(emil),'partner');assert.equal(employeeRoleLabel(emil),'Партнёр');
assert.equal(employeeRoleGroup(head),'department_head');assert.equal(employeeRoleLabel(head),'Руководитель отдела');
assert.equal(emil.role,'department_head','Display grouping does not alter authorization');
console.log('Partner display separates Emil without changing permissions');
