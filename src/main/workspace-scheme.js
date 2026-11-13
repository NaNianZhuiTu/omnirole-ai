/* 必须在 app ready 之前执行一次。pawork 只给 HTML 工作台的独立会话用。 */
'use strict';
const { protocol } = require('electron');

if (!global.__PA_WORKSPACE_SCHEME__) {
  global.__PA_WORKSPACE_SCHEME__ = true;
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'pawork',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}
