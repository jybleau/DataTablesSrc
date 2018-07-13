/**
 * Create an Ajax call based on the table's settings, taking into account that
 * parameters can have multiple forms, and backwards compatibility.
 *
 * @param {object} oSettings dataTables settings object
 * @param {array} data Data to send to the server, required by
 *     DataTables - may be augmented by developer callbacks
 * @param {function} fn Callback function to run when data is obtained
 */
function _fnBuildAjax( oSettings, data, fn )
{
	// Compatibility with 1.9-, allow fnServerData and event to manipulate
	_fnCallbackFire( oSettings, 'aoServerParams', 'serverParams', [data] );

	// Convert to object based for 1.10+ if using the old array scheme which can
	// come from server-side processing or serverParams
	if ( data && $.isArray(data) ) {
		var tmp = {};
		var rbracket = /(.*?)\[\]$/;

		$.each( data, function (key, val) {
			var match = val.name.match(rbracket);

			if ( match ) {
				// Support for arrays
				var name = match[0];

				if ( ! tmp[ name ] ) {
					tmp[ name ] = [];
				}
				tmp[ name ].push( val.value );
			}
			else {
				tmp[val.name] = val.value;
			}
		} );
		data = tmp;
	}

	var ajaxData;
	var ajax = oSettings.ajax;
	var instance = oSettings.oInstance;
	var callback = function ( json ) {
		_fnCallbackFire( oSettings, null, 'xhr', [oSettings, json, oSettings.jqXHR] );
		fn( json );
	};

	if ( $.isPlainObject( ajax ) && ajax.data )
	{
		ajaxData = ajax.data;

		var newData = typeof ajaxData === 'function' ?
			ajaxData( data, oSettings ) :  // fn can manipulate data or return
			ajaxData;                      // an object object or array to merge

		// If the function returned something, use that alone
		data = typeof ajaxData === 'function' && newData ?
			newData :
			$.extend( true, data, newData );

		// Remove the data property as we've resolved it already and don't want
		// jQuery to do it again (it is restored at the end of the function)
		delete ajax.data;
	}

	var baseAjax = {
		"url": typeof ajax === 'string' ?
			ajax :
			'',
		"data": data,
		"success": function (json, status, jqXhr) {
			if ( json === null || jqXhr.status == 204 ) {
				json = {};
				_fnAjaxDataSrc( oSettings, json, [] );
			}

			var error = json.error || json.sError;
			if ( error ) {
				_fnLog( oSettings, 0, error );
			}

			oSettings.json = json;
			callback( json );
		},
		"dataType": "json",
		"cache": false,
		"type": oSettings.sServerMethod,
		"error": function (xhr, error, thrown) {
			var ret = _fnCallbackFire( oSettings, null, 'xhr', [oSettings, null, oSettings.jqXHR] );

			if ( $.inArray( true, ret ) === -1 ) {
				if ( error == "parsererror" ) {
					_fnLog( oSettings, 0, 'Invalid JSON response', 1 );
				}
				else if ( xhr.readyState === 4 ) {
					_fnLog( oSettings, 0, 'Ajax error', 7 );
				}
			}

			_fnProcessingDisplay( oSettings, false );
		}
	};

	// If `ajax` option is an object, extend and override our default base
	if ( $.isPlainObject( ajax ) ) {
		$.extend( baseAjax, ajax )
	}

	// Store the data submitted for the API
	oSettings.oAjaxData = data;

	// Allow plug-ins and external processes to modify the data
	_fnCallbackFire( oSettings, null, 'preXhr', [oSettings, data, baseAjax] );

	// if ( oSettings.fnServerData )
	// {
	// 	// DataTables 1.9- compatibility
	// 	oSettings.fnServerData.call( instance,
	// 		oSettings.sAjaxSource,
	// 		$.map( data, function (val, key) { // Need to convert back to 1.9 trad format
	// 			return { name: key, value: val };
	// 		} ),
	// 		callback,
	// 		oSettings
	// 	);
	// }
	if ( typeof ajax === 'function' )
	{
		// Is a function - let the caller define what needs to be done
		oSettings.jqXHR = ajax.call( instance, data, callback, oSettings );
	}
	else
	{
		// Object to extend the base settings
		oSettings.jqXHR = $.ajax( baseAjax );

		// Restore for next time around
		if ( ajaxData ) {
			ajax.data = ajaxData;
		}
	}
}


/**
 * Update the table using an Ajax call
 *  @param {object} settings dataTables settings object
 *  @returns {boolean} Block the table drawing or not
 *  @memberof DataTable#oApi
 */
function _fnAjaxUpdate( settings )
{
	if ( settings.bAjaxDataGet ) {
		settings.iDraw++;
		_fnProcessingDisplay( settings, true );

		_fnBuildAjax(
			settings,
			_fnAjaxParameters( settings ),
			function(json) {
				_fnAjaxUpdateDraw( settings, json );
			}
		);

		return false;
	}
	return true;
}


/**
 * Build up the parameters in an object needed for a server-side processing
 * request. Note that this is basically done twice, is different ways - a modern
 * method which is used by default in DataTables 1.10 which uses objects and
 * arrays, or the 1.9- method with is name / value pairs. 1.9 method is used if
 * the sAjaxSource option is used in the initialisation, or the legacyAjax
 * option is set.
 *  @param {object} oSettings dataTables settings object
 *  @returns {bool} block the table drawing or not
 *  @memberof DataTable#oApi
 */
function _fnAjaxParameters( settings )
{
	var
		columns = settings.aoColumns,
		features = settings.oFeatures,
		preSearch = settings.oPreviousSearch,
		preColSearch = settings.aoPreSearchCols;

	return {
		draw: settings.iDraw,
		columns: $.map( columns, function ( column, i ) {
			return {
				data: typeof column.mData === 'function' ?
					'function' :
					column.mData,
				name: column.sName,
				searchable: column.bSearchable,
				orderable: column.bSortable,
				search: {
					value: preColSearch[i].sSearch,
					regex: preColSearch[i].bRegex
				}
			};
		} ),
		order: $.map( _fnSortFlatten( settings ), function ( val ) {
			return {
				column: val.col,
				dir: val.dir
			};
		} ),
		start: settings._iDisplayStart,
		length: features.bPaginate ?
			settings._iDisplayLength :
			-1,
		search: {
			value: preSearch.sSearch,
			regex: preSearch.bRegex
		}
	};
}


/**
 * Data the data from the server (nuking the old) and redraw the table
 *  @param {object} oSettings dataTables settings object
 *  @param {object} json json data return from the server.
 *  @param {string} json.sEcho Tracking flag for DataTables to match requests
 *  @param {int} json.iTotalRecords Number of records in the data set, not accounting for filtering
 *  @param {int} json.iTotalDisplayRecords Number of records in the data set, accounting for filtering
 *  @param {array} json.aaData The data to display on this page
 *  @param {string} [json.sColumns] Column ordering (sName, comma separated)
 *  @memberof DataTable#oApi
 */
function _fnAjaxUpdateDraw ( settings, json )
{
	// v1.10 uses camelCase variables, while 1.9 uses Hungarian notation.
	// Support both
	var compat = function ( old, modern ) {
		return json[old] !== undefined ? json[old] : json[modern];
	};

	var data = _fnAjaxDataSrc( settings, json );
	var draw            = compat( 'sEcho',                'draw' );
	var recordsTotal    = compat( 'iTotalRecords',        'recordsTotal' );
	var recordsFiltered = compat( 'iTotalDisplayRecords', 'recordsFiltered' );

	if ( draw ) {
		// Protect against out of sequence returns
		if ( draw*1 < settings.iDraw ) {
			return;
		}
		settings.iDraw = draw * 1;
	}

	_fnClearTable( settings );
	settings._iRecordsTotal   = parseInt(recordsTotal, 10);
	settings._iRecordsDisplay = parseInt(recordsFiltered, 10);

	for ( var i=0, ien=data.length ; i<ien ; i++ ) {
		_fnAddData( settings, data[i] );
	}
	settings.aiDisplay = settings.aiDisplayMaster.slice();

	settings.bAjaxDataGet = false;
	_fnDraw( settings );

	if ( ! settings._bInitComplete ) {
		_fnInitComplete( settings, json );
	}

	settings.bAjaxDataGet = true;
	_fnProcessingDisplay( settings, false );
}


/**
 * Get the data from the JSON data source to use for drawing a table. Using
 * `_fnGetObjectDataFn` allows the data to be sourced from a property of the
 * source object, or from a processing function.
 *  @param {object} oSettings dataTables settings object
 *  @param  {object} json Data source object / array from the server
 *  @return {array} Array of data to use
 */
function _fnAjaxDataSrc ( oSettings, json, write )
{
	var dataSrc = $.isPlainObject( oSettings.ajax ) && oSettings.ajax.dataSrc !== undefined ?
		oSettings.ajax.dataSrc :
		oSettings.sAjaxDataProp; // Compatibility with 1.9-.

	if ( ! write ) {
		// Compatibility with 1.9-. In order to read from aaData, check if the
		// default has been changed, if not, check for aaData
		if ( dataSrc === 'data' ) {
			return json.aaData || json[dataSrc];
		}

		return dataSrc !== "" ?
			_fnGetObjectDataFn( dataSrc )( json ) :
			json;
	}
	else {
		_fnSetObjectDataFn( dataSrc )( json, write );
	}
}
