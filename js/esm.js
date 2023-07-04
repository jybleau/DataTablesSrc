/*! DataTables 1.13.5
 * ©2008-2023 SpryMedia Ltd - datatables.net/license
 */

import jQuery from 'jquery';

// DataTables code uses $ internally, but we want to be able to
// reassign $ with the `use` method, so it is a regular var.
var $ = jQuery;

_buildInclude('core.main.js');

export default DataTable;
