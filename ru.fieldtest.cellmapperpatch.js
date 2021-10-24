const PREF_SORT_NETWORKS	= true;	// { true / false} Sort providers list by network code instead of network name
const PREF_AREA_CAPTION		= true;	// { true / false} Append area code after site number label 
const PREF_SECTOR_CAPTION	= true;	// { true / false} Show sector caption inside coverage area

const VERSION				= 'ver. 2109-1';
const RESEND_AFTER_ATTEMPTS	= 20;
const MIN_ATTEMPTS			= 0;
const MAX_ATTEMPTS			= 160;
const NOT_CONFIRMED			= 999;

const MX = "ff", HI = "ee", ME = "99", LO = "44", ZZ = '00';
const _colors =
{//	Channel	  Color Hex
//	'000'	: 'ff88800',		 // 000-00 B0
	'1602'	: `${ME}${ZZ}${ZZ}`, // 250-02 B3
	'2850'	: `${LO}${HI}${ZZ}`, // 250-02 B7
	'3048'	: `${ME}${ME}${ZZ}`, // 250-02 B7
	'6350'	: `${LO}${ZZ}${HI}`, // 250-02 B20
	'37900'	: `${ZZ}${ME}${ME}`, // 250-02 B38
	'6175'	: `${LO}${ZZ}${HI}`, // 250-20 B20
};
const _featureFont = window.devicePixelRatio >= 2 ? '11px Lato' : 'bold 10px Lato';

(function apply() {
'use strict';
if (document.readyState === 'loading')
{
	document.addEventListener("readystatechange", apply, false);
	return;
}
else if (typeof insertAds === 'function' && insertAds.toString() === '(skip) => { }')
{
	document.removeEventListener("readystatechange", apply, false);
	return;
}
else if (typeof changeMapType !== 'function')
{
    alert('Patch cannot be applied.\nPlease disable programmatic injection.');
	return;
}

const _handleResponse = handleResponse;
const _MD5 = MD5;
const _getBaseStation = getBaseStation;
const _markerExists = markerExists;
const _getTilesAvailable = getTilesAvailable;
const _handleTowerMove = handleTowerMove;
const _getExtraContent = getExtraContent;
var bandNotation = "B";
var imageStyleVerified = null;

function renderBandList(channels, bands, notation = "")
{
	const uniqueChannels = [];
	const duplicatedBands = [];
	const uniqueBands = [];
	
	bands.sort((a, b) => a - b);
	const fallback = notation + bands.join(`, ${notation}`);
	var text = notation;
	
	for (const channel of channels)
	{
		if (channel > 0 && !uniqueChannels.includes(channel))
			uniqueChannels.push(channel);
	}
	
	for (const channel of uniqueChannels)
	{
		const band = frequencyCache?.[MCC]?.[netType]?.[channel]?.bandNumber ?? 0;
		
		if (band < 1)
			return fallback;
		
		duplicatedBands.push(band);
	}

	duplicatedBands.sort((a, b) => a - b);
	for (const band of duplicatedBands)
	{
		if (!uniqueBands.includes(band))
		{
			text += `, ${notation}${band}`;
			uniqueBands.push(band);
		}
		else
		{
			text += `+${band}`;
		}
	}
	
	return text.substring(2);
}

function renderBandDescription(band, notation = bandNotation, isCenterNotRange = true)
{
	const centerFrequency = isCenterNotRange ?
							Math.floor(((band.endDownlinkFrequency - band.startDownlinkFrequency) / 2 + band.startDownlinkFrequency) / 100) * 100 :
							`${band.startDownlinkFrequency} - ${band.endDownlinkFrequency}`;
	return `${notation}${band.bandNumber} (${netType} ${centerFrequency} ${band.modulation})`;
}

async function validateOverride(inMCC, inMNC, inSystem, inLAC, inBase, inCell, lat, lon, attempt)
{
	var assigned = false;
	var relocated = false;
	var recalculated = false;
	var log = `validateOverride[#${attempt}]:`;
	var test = '';
	
	if (!relocated)
	{
		await fetch(API_URL + 'getTowerOverrideHistory?' + new URLSearchParams(
		{
			MCC: inMCC,
			MNC: inMNC,
			RAT: inSystem,
			Region: inLAC,
			Site: inBase,
			offset: 0,
		}),
		{
			credentials: 'include'
		})
		.then((response) => response.json())
		.then((response) =>
		{
			const towerData = handleResponse(response);

			if (towerData?.length > 0
			&&	towerData?.[0]?.uid == userID)
				assigned = true;

			log += ` exp. [${userID}] ${assigned ? '==' : '!='} [${towerData?.[0]?.uid}] `;
		});
	}

	if (assigned)
	{
		await fetch(API_URL + 'getTowerInformation?' + new URLSearchParams(
		{
			MCC: inMCC,
			MNC: inMNC,
			RAT: inSystem,
			Region: inLAC,
			Site: inBase,
			offset: 0,
		}),
		{
			credentials: 'include'
		})
		.then((response) => response.json())
		.then((response) =>
		{
			const towerData = handleResponse(response);
			lat = parseFloat(lat).toString();
			lon = parseFloat(lon).toString();

			if ((towerData?.latitude ?? 0.0).toString() == lat
			&&	(towerData?.longitude ?? 0.0).toString() == lon)
				relocated = true;

			if (relocated
			&&	towerData?.towerMover == userID)
				recalculated = true;
				
			log += ` exp. [${lat}, ${lon}] ${relocated ? '==' : '!='} [${towerData?.latitude ?? 0.0}, ${towerData?.longitude ?? 0.0}]`;
		});
	}

	console.log(log);
	
	if (relocated && assigned && attempt % RESEND_AFTER_ATTEMPTS > 5)
		return attempt;			// { 0..+X } OK, position confirmed, history confirmed

	if (attempt < MAX_ATTEMPTS)
	{
		attempt += 1;

		if (attempt % RESEND_AFTER_ATTEMPTS === 0)
			return await doOverride(inMCC, inMNC, inSystem, inLAC, inBase, inCell, lat, lon, attempt);
			
		return await validateOverride(inMCC, inMNC, inSystem, inLAC, inBase, inCell, lat, lon, attempt);
	}

	if (relocated)
		return NOT_CONFIRMED;	// { 0..+X } OK, position confirmed, history not confirmed

	return -attempt;			// { -1..-X } FAIL, nothing confirmed
}

function handleTowerInformation(responseData)
{
	for (const [cid, cell] of Object.entries(responseData.cells))
	{
		delete cell.SubSystem;
		//delete cell.Bearing;
		delete cell.AVG_CURRENT_SPEED_DOWNLINK_MBPS;
		delete cell.MAX_CURRENT_SPEED_DOWNLINK_MBPS;
		delete cell.AVG_CURRENT_SPEED_UPLINK_MBPS;
		delete cell.MAX_CURRENT_SPEED_UPLINK_MBPS;
	}

	if (responseData.channels !== null
	&&	responseData.channels.length > 0)
	{
		const bands = renderBandList(responseData.channels, responseData.bandNumbers);

		responseData.bandNumbers.length = 0;
		responseData.bandNumbers.push(bands);
	}

	if (responseData.RAT === 'GSM' || responseData.RAT === 'UMTS')
	{
		const site = parseInt(responseData.siteID) & 0xffff;
		const area = parseInt(responseData.regionID);

		responseData.groupID = site;
		responseData.siteID = (area << 16) | site;
		//console.log(`handleTowerInformation: responseData reencoded [${site}, ${area}] into ${responseData.siteID}`);
	}
	else
	{
		responseData.groupID = parseInt(responseData.siteID);
	}
}

function handleFrequency(responseData)
{
	if (responseData?.netType == 'GSM')
	{
		if (responseData?.bandNumber === 900)
			responseData.bandNumber = 8;
		else if (responseData?.bandNumber === 1800)
			responseData.bandNumber = 3;
	}

	frequencyCache[MCC][netType][responseData.Frequency] = responseData;
	localStorage.setItem('frequencyCache', JSON.stringify(frequencyCache));
}

function handleRecaptcha(response)
{	
	const dialog = document.getElementById('dialog-requests-exceeded');

	if (response == null
	||	response?.responseData == null)
	{
		console.log(`handleRecaptcha: responseData is empty`);
		return null;
	}

	if (response?.statusCode != "OKAY")
	{
		if (response != null
		&&	response?.statusCode != "NEED_RECAPTCHA"
		&&	response?.responseData != "Cannot calculate band data")
		{
			$("#toastMessageBody").html("<div>An error occured:<br /><b>" + response?.responseData  + "</b></div>");
			$('#toastMessage').toast('show');
			//throw new Error("An error occured.");
		}
		else if (response?.statusCode == "NEED_RECAPTCHA")
		{
			$('#dialog-requests-exceeded').modal('show');

			apicaptchawidget = grecaptcha.render('apicaptcha',
			{
	 			sitekey: "6LeRrhIUAAAAAC0_WQguxdrrcHztb8RLS03lFgE2",
	 			callback: function(recaptcha)
	 			{
 					captchaCode = recaptcha;

 					$.ajax(
 					{
 						type: "POST",
 						dataType: "json",
 						url: API_URL + "recaptcha",
 						xhrFields: { withCredentials: true },
 						data:
 						{
 							code: captchaCode,
 							channel: "web"
 						},
 						success: function(validated)
 						{
 							//var data = handleResponse(validated);
 							//handleResponse(validated);
 
 							grecaptcha.reset(apicaptchawidget);
							$('#dialog-requests-exceeded').modal('hide');

							updateMNClist();
							getUserProfile();
 						}
 					});
	 			}
	 		});
		}
	}

	return response?.responseData;
}

function initMercatorProjection()
{
	const pi_2 = Math.PI / 2;
	const pi_180 = Math.PI / 180.0;
	const pi_360 = Math.PI / 360.0;
	
	const equatorial_radius = 6378137.000;
    const polar_radius = 6356752.3142;
    const ratio = polar_radius / equatorial_radius; //0.99664718932816902490492129598345;	// polar_radius / equatorial_radius
    //const es = 1 - Math.pow(ratio, 2); //0.00335281067183097509507870401655; // 1.0 - ratio * ratio,
    const eccent = Math.sqrt(1.0 - Math.pow(ratio, 2)); // Math.sqrt(es),
    const com = eccent / 2;
	const pi_180_r = Math.PI / 180.0 * equatorial_radius;
	
	var web_world_cache = [[0, 0], [0, 0]];
	var world_lonlat_cache = [[0, 0], [0, 0]];

    const epsg4326 = ol.proj.get('EPSG:4326');
    const epsg3857 = ol.proj.get('EPSG:3857');
	const epsg3395 = new ol.proj.Projection({
    	code: 'EPSG:3395',
    	units: 'm',
    	extent: [-20037508.342789244, -20037508.342789244, 20037508.342789244, 20037508.342789244],
	});
	epsg3395.web_world_transform = (coord) =>
	{	// layer mapping 
		const lat = Math.atan(Math.exp(coord[1] / equatorial_radius)) / pi_360 - 90;
		
	    const phi = lat * pi_180; 
	    const sinphi = Math.sin(phi);
	    var con = eccent * sinphi;
	    con = Math.pow( (1 - con) / (1 + con), com );
	    const ts = Math.tan( (pi_2 - phi) / 2 ) / con;
	    const y =  -equatorial_radius * Math.log(ts);

		//console.log(`transform_web_world() [${coord[0]} ${coord[1]}] -> [${coord[0]} ${y}]`);
		return [coord[0], y];
	};
	
	epsg3395.world_lonlat_transform = (coord) =>
	{	// layer mapping 
		var lonlat = [];
		
		if (world_lonlat_cache[0][0] === coord[0])
			lonlat[0] = world_lonlat_cache[1][0];
		else	
			lonlat[0] = coord[0] / pi_180_r;
		
		if (world_lonlat_cache[0][1] === coord[1])
			lonlat[1] = world_lonlat_cache[1][1];
		else
		{
	        const ts = Math.exp(-coord[1] / equatorial_radius);

	        var phi = pi_2 - 2 * Math.atan(ts);
	        var dphi = 1.0;

	        for (var i = 0; i < 15 && Math.abs(dphi) > 0.000000001; i++)
	        {
	            const con = eccent * Math.sin(phi);
	            dphi = pi_2 - 2 * Math.atan(ts * Math.pow((1.0 - con) / (1.0 + con), com)) - phi;
	            phi += dphi;
	        }
	        
			lonlat[1] = phi / pi_180;
		}
		
		world_lonlat_cache[0] = coord;
		world_lonlat_cache[1] = lonlat;
		
        /*const lonlat = [
			coord[0] / pi_180_r,
			phi / pi_180
    	];*/
   
    	//console.log(`transform_world_lonlat() [${coord[0]} ${coord[1]}] -> [${lonlat[0]} ${lonlat[1]}]`);
    	return lonlat;
    };

    ol.proj.addProjection(epsg3395);
    ol.proj.addCoordinateTransforms(epsg3857, epsg3395, epsg3395.web_world_transform/* , null epsg3395.world_web_transform*/);
    ol.proj.addCoordinateTransforms(epsg4326, epsg3395,  null /* epsg3395.lonlat_world_transform*/, epsg3395.world_lonlat_transform);
    
    //ol.proj.addCoordinateTransforms(epsg3395.projection, epsg3857, epsg3395.world_web_transform, epsg3395.web_world_transform);
    //ol.proj.addCoordinateTransforms(epsg3395.projection, epsg4326, epsg3395.world_lonlat_transform, epsg3395.lonlat_world_transform);
}

function initMap()
{
	map.getView().setConstrainResolution(true);
	map.interactions.array_[1].duration_ = 0;
	map.interactions.array_[6].duration_ = 0;
	map.interactions.array_[7].duration_ = 0;
	map.interactions.array_[8].duration_ = 0;
	
	map.interactions.array_.splice(8, 1);
	map.interactions.array_.splice(3, 4);
	map.interactions.array_.splice(0, 1);
	map.interactions.values_.length = 3;
}

function initPredefinedChannels(inMCC, inMNC, inRAT)
{
	if (inRAT === 'GSM')
	{
		for (var ch = 0; ch <= 124; ch++)
			frequencyCache[inMCC][inRAT][ch] = { bandNumber: 8 };

		for (var ch = 512; ch <= 885; ch++)
			frequencyCache[inMCC][inRAT][ch] = { bandNumber: 3 };

		for (var ch = 975; ch <= 1023; ch++)
			frequencyCache[inMCC][inRAT][ch] = { bandNumber: 8 };
	}
	else if (inRAT === 'UMTS')
	{
		for (var ch = 10562; ch <= 10838; ch++)
			frequencyCache[inMCC][inRAT][ch] = { bandNumber: 1 };
	}
	else if (inRAT === 'LTE')
	{
		for (var ch = 1200; ch <= 1949; ch++)
			frequencyCache[inMCC][inRAT][ch] = { bandNumber: 3 };
			
		for (var ch = 2750; ch <= 3449; ch++)
			frequencyCache[inMCC][inRAT][ch] = { bandNumber: 7 };
			
		for (var ch = 6150; ch <= 6549; ch++)
			frequencyCache[inMCC][inRAT][ch] = { bandNumber: 20 };
	}
}

function setVerifiedStyle(feature)
{
	if (feature.get('verified') == true)
		return;

	if (typeof feature.getStyle() === 'function')
	{
		feature.isMoved = true;
		return;
	}
	
	delete feature.isMoved;
	const style = feature.getStyle();
	
	if (imageStyleVerified == null)
	{
		imageStyleVerified = style.getImage().clone();
		imageStyleVerified.color_ = [0x4a, 0xbe, 0, 1];
		imageStyleVerified.iconImage_.color_ = [0x4a, 0xbe, 0, 1];
	}

	style.setImage(imageStyleVerified);
	style.getText().getBackgroundFill().setColor('#ffffff');

	feature.set('verified', true);
}

function toSuperscript(num)
{
	const dict = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻' };
	// 'a':'ᵃ','b':'ᵇ','c':'ᶜ','d':'ᵈ','e':'ᵉ','f':'ᶠ','g':'ᵍ','h':'ʰ','i':'ⁱ','j':'ʲ','k':'ᵏ','l':'ˡ','m':'ᵐ','n':'ⁿ','o':'ᵒ','p':'ᵖ','r':'ʳ','s':'ˢ','t':'ᵗ','u':'ᵘ','v':'ᵛ','w':'ʷ','x':'ˣ','y':'ʸ','z':'ᶻ'
	
	return num.toString().split('').map((c) =>
	{
		return dict[c] ?? '';
	}).join('');
}

insertAds = (skip) => { };

_renderGetFrequency = (data) => { };

_renderCalculateFrequency = (data, inCellID, isEstimated) =>
{
	const band = bandCache[data.bandNumber];

	if (isEstimated || band === undefined)
		return;
		
	const rowHtml = `<tr><td width='50%'>Frequency Band</td><td>${renderBandDescription(band)}</td></tr>`;

	$(`#detailsTable${inCellID} > tbody > tr`)
	.filter((index, element) =>
	{
		return element.innerText.includes('RFCN');
	})
	.before(rowHtml);
};

handleResponse = (response) =>
{
	const responseData = handleRecaptcha(response);

	if (responseData?.siteID != null && responseData?.cells)
	{	// getTowerInformation
		handleTowerInformation(responseData);
	}
	else if (responseData?.Frequency != null)
	{	// getFrequency
		handleFrequency(responseData);
	}
	/*else if (responseData?.startDownlinkFrequency != null)
		console.log(`handleResponse: getBandData`);
	else if (responseData?.channelNumber != null)
		console.log(`handleResponse: getEstimatedBand`);
	else
		console.log(`handleResponse: other responce`);
	*/

	return responseData;
};

MD5 = (channel) => { return _colors[channel] ?? _MD5(channel); };

updateMNClist = async () =>
{
	await fetch(API_URL + "getAllNetworks", { credentials: 'include' })
	.then((response) => response.json())
	.then((response) =>
	{
		const mnc_select = $('#MNCSelect');
		
		$('#NETSelect').empty();
		$('#NETSelect').trigger("chosen:updated");

		mnc_select.empty();
		mnc_select.append($('<option>').text("Select Provider").val(-1));

		MCCList = handleResponse(response);

		for (const country in MCCList)
		{
			const opts = $('<optgroup>').attr("label", country);
			const networks = MCCList[country];
			
			if (PREF_SORT_NETWORKS)
				networks.sort((a, b) => a.providerID - b.providerID);

			for (const network of networks)
			{
				const mnc = network.providerID.toString().padStart(2, '0');
				if (network.visible)
					opts.append($('<option>')
						.html(`${network.countryID} ${mnc} - ${network.providerName}`)
						.val(`${network.countryID}${network.providerID}`)
					);
			}

			mnc_select.append(opts);
		}

		// Select the current MCC/MCC and fire event / read cookie
		if (MCC !== null && MNC !== null)
		{
			getNetworkInfo(MCC, MNC);
			document.querySelector(`#MNCSelect option[value='${MCC}${MNC}']`).selected = 'selected';
		}
		else
		{
			if ($.cookie('selectedProvider') !== undefined)
			{
				MCC = parseInt($.cookie('selectedProvider').substring(0,3));
				MNC = parseInt($.cookie('selectedProvider').substring(3));
			}
		}

		mnc_select.trigger("chosen:updated");
	});
};
// Gets the coverage per cell, and displays it
getTowerCoverage = (inMCC, inMNC, inLAC, inbase, colour, highlight) =>
{
	if (currentSite.siteID == prevbase)
		return true;

	// Clear all previous coverage areas
	clearCoverage();
	prevbase = currentSite.siteID;
	inbase = currentSite.groupID;

	fetch(API_URL + 'getTowerCoverage?' + new URLSearchParams(
	{
		MCC: inMCC,
		MNC: inMNC,
		RAT: netType,
		Site: inbase,
		Region: inLAC,
	}),
	{
		credentials: 'include'
	})
	.then((response) => response.json())
	.then((response) =>
	{
		const responseData = handleRecaptcha(response);
		const cells = new ol.Collection();

		Object.entries(responseData).forEach(([cell, sectorData], i) =>
		{
			const sector = currentSite?.cells[cell]?.Sector.toString() + (currentSite?.cells[cell]?.ENDC_AVAILABLE ? '⁺ᴺᴿ' : '');
			const sectorIndex = Object.entries(currentSite.cells).findIndex((c) => c[0] === cell);
		    const channel = currentSite?.channels[sectorIndex] ?? 0;
			const band = frequencyCache?.[inMCC]?.[netType]?.[channel]?.bandNumber ?? 0;

			if (band !== showBand && showBand !== 0 && band !== 0)
				return;

			const polyCoords = [];

			for (const c of sectorData)
			{
		    	polyCoords.push(ol.proj.transform([c[1], c[0]], 'EPSG:4326', 'EPSG:3857'));
			}

			if (polyCoords.length === 0)
				return;

			// Colours
			var baseColour = sectorColors[cell];
			
			if (typeof baseColour == 'undefined')
		    	baseColour = "#000000";
			else
		    	baseColour = "#" + baseColour;
		
		    var colour = ol.color.asArray(baseColour);
		    colour = colour.slice();
		    colour[3] = 0.2;
		
		    var strokeColor = ol.color.asArray(baseColour);
		    strokeColor = strokeColor.slice();
		    strokeColor[3] = 1.0;
		    
			sectorStyles[cell] = new ol.style.Style(
			{
				stroke: new ol.style.Stroke(
				{
			    	color: (strokeColor),
			    	width: 3
				}),
				fill: new ol.style.Fill(
				{
			    	color: (colour),
			    	opacity: colour[3]
				}),
				text: new ol.style.Text({
			        font: '16px Lato',
			        text: PREF_SECTOR_CAPTION ? sector : null,
					stroke: new ol.style.Stroke(
					{
				    	color: (strokeColor),
				    	width: 3
					}),
			        fill: new ol.style.Fill({
			            color: 'white'
			        })
			    })
			});

		    sectorStylesHighlighted[cell] = new ol.style.Style(
		    {
				stroke: new ol.style.Stroke(
				{
					color: (strokeColor),
					width: 6
				}),
				fill: new ol.style.Fill(
				{
					color: (colour),
				}),
				text: new ol.style.Text({
			        font: '20px Lato',
			        text: sector,
					stroke: new ol.style.Stroke(
					{
				    	color: (strokeColor),
				    	width: 6
					}),
			        fill: new ol.style.Fill({
			            color: 'white'
			        })
			    }),
			});//*/
	
			// add first item again to close
			polyCoords.push(polyCoords[0]);
			var feature = new ol.Feature(
			{
	    		geometry: new ol.geom.Polygon([polyCoords])
			});
			feature.set("CID", cell);
			feature.setStyle(sectorStyles[cell]);
			cells.push(feature);
		});

		CoveragePolygonLayer = new ol.layer.Vector({
			zIndex: 2,
		    source: new ol.source.Vector({
		        features: cells,
		    	projection: 'EPSG:3857',
		    }),
		});
		
		map.addLayer(CoveragePolygonLayer);
	});
};
// Load all the countries
getBaseStation = (inMCC, inMNC, inLAC, inBase, inMarker) =>
{
	document.getElementById('tabs-2').scrollTop = 0;
	return _getBaseStation(inMCC, inMNC, inLAC, inBase, inMarker);
};

getBandName = (inRAT, inBand, targetDiv) =>
{
	if (inRAT == 'GSM')
	{
		inRAT = 'LTE';
		
		switch (inBand)
		{
		case '900':
			inBand = 8;
			break;
		case '1800':
			inBand = 3;
			break;
		}
	}
	
	if (bandCache[inBand] !== undefined)
	{
		_HandleGetBandName(bandCache[inBand], targetDiv);
		return;
	}

	fetch(API_URL + 'getBandData?' + new URLSearchParams(
	{
		MCC: MCC,
		RAT: inRAT,
		Band: inBand,
	}),
	{
		credentials: 'include'
	})
	.then((response) => response.json())
	.then((response) =>
	{
		var data = handleRecaptcha(response);
		
		bandCache[inBand] = data;
		localStorage.setItem('bandCache', JSON.stringify(bandCache));
		_HandleGetBandName(data, targetDiv);
	});
};

_HandleGetBandName = (data, targetDiv) =>
{
	const bandDescription = renderBandDescription(data, 'Band ', false);
	
	if (!targetDiv)
	{
		$(`#BandSelect option[value='${data.bandNumber}']`).text(bandDescription);
		$('#BandSelect').trigger("chosen:updated");
	}
	else if (targetDiv.startsWith('band'))
	{
		$(`#band${data.bandNumber}`).replaceWith(bandDescription);
	}
};

getTilesAvailable = (inMCC, inMNC, inRAT) =>
{
	if (frequencyCache[inMCC] === undefined 
	||	frequencyCache[inMCC] instanceof Array)
		frequencyCache[inMCC] = {};
	
	if (frequencyCache[inMCC][inRAT] === undefined 
	||	frequencyCache[inMCC][inRAT] instanceof Array)
	{
		frequencyCache[inMCC][inRAT] = {};
		initPredefinedChannels(inMCC, inMNC, inRAT);
	}
	
	localStorage.setItem('frequencyCache', JSON.stringify(frequencyCache));
	bandNotation = inRAT == 'NR' ? 'n' : 'B';
	return _getTilesAvailable(inMCC, inMNC, inRAT);
}

doOverride = async (inMCC, inMNC, inSystem, inLAC, inBase, inCell, lat, lon, attempt = 0) =>
{
	//console.log(`doOverride[#${attempt}]: ${inMCC}, ${inMNC}, ${inSystem}, ${inLAC}, ${inBase}, ${inCell}, ${lat}, ${lon}`);
	const selectedSite = prevbase;
	
	$('#toastMessage').toast('dispose');

	return fetch(API_URL + 'overrideData?' + new URLSearchParams(
	{
		MCC: inMCC,
		MNC: inMNC,
		Region: inLAC,
		RAT: inSystem,
		Site: inBase,
		CellID: inCell,
		Latitude: lat,
		Longitude: lon,
	}),
	{
		credentials: 'include'
	})
	.then((response) => response.json())
	.then(async (response) =>
	{
		const noteText = handleResponse(response);
		var validated = null;
		var msg = '';

		if (inCell === null && lat != 0 && lon != 0)
		{	// move request
			validated = await validateOverride(inMCC, inMNC, inSystem, inLAC, inBase, inCell, lat, lon, attempt);

			if (validated === undefined)
				return;

			if (validated >= MIN_ATTEMPTS && validated < RESEND_AFTER_ATTEMPTS)
				msg	= 'Location updated';
			else if (validated == NOT_CONFIRMED)
				msg = 'Location updated (no confirmation)';
			else if (validated > MIN_ATTEMPTS)
				msg	= `Location updated (after ${Math.floor(validated / RESEND_AFTER_ATTEMPTS) + 1} retries)`;
			else if (validated < MIN_ATTEMPTS)
				msg = `Location not updated after ${Math.floor(-validated / RESEND_AFTER_ATTEMPTS) + 1} retries`;
		}
		else if (noteText == "OKAY")
			msg = 'Action successful';
		else
			msg = `An error occured: ${noteText}`;

		$("#toastMessageBody").html(msg);
		$('#toastMessage').toast({delay: 3000});
		$('#toastMessage').toast('show');
		console.log(`doOverride[#${attempt}]: toast '${msg}' to be shown`);

		if (lat != 0 && lon != 0 && validated >= MIN_ATTEMPTS)
		{
			moveTower(inMCC, inMNC, inSystem, inLAC, inBase, lat, lon);

			if (prevbase == selectedSite)
			{
				if (CoveragePolygonLayer != null)
					CoveragePolygonLayer.setOpacity(0.33);
	
				setTimeout(() =>
				{
					if (prevbase == selectedSite)
					{
						prevbase = null;	// in order coverage to be rapainted
						getBaseStation(inMCC, inMNC, inLAC, inBase);
					}
				}, 3000);
			}

			return;
		}
		
		if (lat == 0 && lon == 0 && noteText == "OKAY")
		{
			removeTower(inMCC, inMNC, inSystem, inLAC, inBase);

			if (CoveragePolygonLayer != null)
				CoveragePolygonLayer.getSource().clear();

			select_interaction.getFeatures().clear();

			if (currentTranslate != null)
				map.removeInteraction(currentTranslate);
			
			return;
		}
	});
};

handleTowerMove = (tower, latitude, longitude) =>
{
	$('#toastMessage').toast('dispose');
	_handleTowerMove(tower, latitude, longitude);
};

moveTower = (inMCC, inMNC, inSystem, inLAC, inBase, inLat, inLng) =>
{
	for (const feature of Towers)
	{
		if (feature != undefined && feature.get('base') == inBase && feature.get('LAC') == inLAC)
		{
			const position = new ol.geom.Point(ol.proj.transform([parseFloat(inLng), parseFloat(inLat)], 'EPSG:4326', 'EPSG:3857'));
			feature.setGeometry(position);
			setVerifiedStyle(feature);
			break;
		}
	}
}

removeTower = (inMCC, inMNC, inSystem, inLAC, inBase) =>
{
	for (const [i, feature] of Towers.entries())
	{
		if (feature != undefined && feature.get("base") == inBase && feature.get("LAC") == inLAC)
		{
			try
			{
				vectorSourceTowers.removeFeature(feature);
				Towers.splice(i, 1);
			}
			catch (exception)
			{
			}
			break;
		}
	}
  
	refreshTowers();
};

markerExists = (feature) =>
{
//	As injection into getTowersInView() after feature created
	const rat = feature.get('system');
	const site = feature.get('base');
	var area = 0;

	if (rat === 'GSM' || rat === 'UMTS')
		area = parseInt(feature.get('regionID'));

	feature.set('siteID', (area << 16) | site);
	
	if (true)
	{
		const svg = '<svg width="20" height="20" version="1.1" xmlns="http://www.w3.org/2000/svg">'
    			  + '<circle cx="10" cy="10" r="7" fill="white" stroke="black" stroke-width="2.5" />'
    			  + '</svg>';
		const imageStyle = feature.getStyle().getImage();
		imageStyle.iconImage_.src_ = `data:image/svg+xml;utf8,${svg}`;
	}

	if (showTowerLabels)
	{
		var text = feature.get('base') +
//		const PREF_SECTORS_CAPTION = true;
//					(PREF_SECTORS_CAPTION ? toSuperscript('') : '') +
					(PREF_AREA_CAPTION && area > 0 ? ' ' + toSuperscript(area) : '');
		
		if (feature.get('bands').length > 0)
		{
			const bands = renderBandList(feature.get('arfcns'), feature.get('bands'), bandNotation);
			text += '\n' + bands;
		}

		const textStyle = feature.getStyle().getText();
		textStyle.setOffsetY(27);
		textStyle.setFont(_featureFont);
		textStyle.setText(text);

		if (feature.get('verified') === false)
		{
			textStyle.getBackgroundFill().setColor('#ffc0c0');
		}
	}

	return _markerExists(feature);	// _markerExists() handles siteId + areaId properly 
}

getExtraContent = (towerDetailsPage, target) =>
{
//	As injection into getBaseStation() after details propagated
	if (target === '#tabs-2')
	{
		document.querySelectorAll(`#tabs-2 .table-striped > tbody > tr`)
		.forEach((element) =>
		{
			if (element.innerText.includes('Address'))
			{	
				element.removeChild(element.childNodes[0]);
				element.childNodes[0].colSpan = 2;
			}
			else if (element.innerText.includes('Direction'))
			{	
				element.style.display = 'none';
				element.parentNode.removeChild(element);
			}
			else if (element.innerText.includes('Maximum Signal'))
				element.innerHTML = element.innerHTML.replace('Maximum Signal', 'Max Signal');
		});
	}

	_getExtraContent(towerDetailsPage, target);
};

setupRightClick = () =>
{
    map.on('contextmenu', (event) =>
    {
		var coord	= ol.proj.transform(event.coordinate, 'EPSG:3857', 'EPSG:4326');
		var lat     = coord[1];
		var lon		= correctLongitude(coord[0]);
		
		// gen Content
		var theHTML = ''
                      /*+ '<a href="#" onclick="showCountryClick(' + lat + ', ' + long + ')">Select Provider</a><br />'*/
                      /*+ '<a href="#" onclick="locateClosestTower(' + lat + ', ' + long + ')">Locate Closest Tower</a><br />'*/
                      + `<a href="https://www.google.com/maps/@${lat},${lon},17z" target="_blank" rel="noreferrer">Google Maps</a><br />`
                      + `<a href="https://www.google.com/maps?layer=c&cbll=${lat},${lon}" target="_blank" rel="noreferrer">Google Streetview</a><br />`
                      + `<a href="https://yandex.net/maps?ll=${lon},${lat}&z=17" target="_blank" rel="noreferrer">Yandex Maps</a><br />`
                      + `<a href="https://yandex.net/maps?ll=${lon},${lat}&z=17&mode=whatshere&panorama[point]=${lon}%2C${lat}&panorama[full]=true&whatshere[point]=${lon},${lat}" target="_blank" rel="noreferrer">Yandex Panoramas</a><br />`
                      + '';
		
		$('#popoverOption').attr('data-content', theHTML);
		$('#popoverOption').popover('show');
		// hack to fix content event stripping
		//$(".popover-body").html(theHTML);
	});

	map.on('click', (event) =>
	{
		if ($('.contextmenu').is(":visible"))
			$('.contextmenu').remove();
	});
}

changeMapType = (newType) =>
{
	var baseLayer;
	var baseOpacity = 1.0;
	const layers = map.getLayers();

	if (map.revision_ === 0)
	{
		initMap();
        if (layers.getLength() > 0)
            layers.removeAt(0);
		map.revision_++;
    }

	if (newType.includes('yandex') && ol.proj.get('EPSG:3395') == null)
	{
		initMercatorProjection();
	}

	layers.forEach((l) =>
	{
		if (l !== undefined && typeof l.values_.mapType !== 'undefined')
			layers.remove(l);
	});

	const pixelRatio = Math.ceil(window.devicePixelRatio);

	if (newType == "esri_satellite")
		baseLayer = new ol.source.XYZ({
			url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
			maxZoom: 23,
			crossOrigin: 'anonymous'
		});
	else if (newType == "esri_topo")
		baseLayer = new ol.source.XYZ({
			url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'
		});
	else if (newType == "usgs_satellite")
		baseLayer = new ol.source.XYZ({
			url: 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'
		});	
	else if (newType == "google_hybrid")
		baseLayer = new ol.source.XYZ({
           	maxZoom: 20,
           	tilePixelRatio: pixelRatio,
		    projection: 'EPSG:3857',
           	tileUrlFunction: (tileCoord) =>
           	{
           		return `https://mt.googleapis.com/vt?lyrs=y&x=${tileCoord[1]}&y=${tileCoord[2]}&z=${tileCoord[0]+pixelRatio-1}&style=high_dpi&w=${256 * pixelRatio}`;
			},
	    });
	else if (newType == "yandex_map")
		baseLayer = new ol.source.XYZ({
		    url: `https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}&scale=${pixelRatio}`,
		    maxZoom: 21,
		    tilePixelRatio: pixelRatio,
		    projection: 'EPSG:3395',
		});
	else if (newType == "google_yandex_hybrid")
	{	// Source code published as https://t.me/ru_fieldtest_modemcaps
		baseLayer = new ol.source.XYZ({
           	maxZoom: 20,
           	tilePixelRatio: pixelRatio,
		    projection: 'EPSG:3857',
           	tileUrlFunction: (tileCoord) =>
           	{
           		return `https://mt.googleapis.com/vt?lyrs=s&x=${tileCoord[1]}&y=${tileCoord[2]}&z=${tileCoord[0]+pixelRatio-1}&style=high_dpi&w=${256 * pixelRatio}`;
			},
	    });
		layers.push(new ol.layer.Tile({source: baseLayer, mapType: true}));

		baseLayer = new ol.source.XYZ({
		    url: `https://core-renderer-tiles.maps.yandex.net/tiles?l=skl&x={x}&y={y}&z={z}&scale=${pixelRatio}`,
		    maxZoom: 21,
		    tilePixelRatio: pixelRatio,
		    projection: 'EPSG:3395',
		});
		baseOpacity = 0.8;
	}
	else
		baseLayer = new ol.source.OSM({
			attributions: [],
			crossOrigin: 'anonymous'
		});

	var toAddLayer = new ol.layer.Tile({ source: baseLayer, mapType: true, opacity: baseOpacity });
	layers.push(toAddLayer);
	mapType = newType;
	$.cookie('mapType', mapType, { expires: 3600 });
};

{
	const frequencyStorage = localStorage.getItem('frequencyCache');
	frequencyCache = (frequencyStorage != null) ? JSON.parse(frequencyStorage) : {};
	
	const bandStorage = localStorage.getItem('bandCache');
	bandCache = (bandStorage != null) ? JSON.parse(bandStorage) : {};
}
{
	$('#NETSelect').chosen({disable_search_threshold: 10});
	$('#BandSelect').chosen({disable_search_threshold: 10});

	$('#MNCSelect').chosen().change(() =>
	{
		prevbase = null;
	});

	$('#NETSelect').chosen().change(() =>
	{
		prevbase = null;
	});

	$('#BandSelect').chosen().change(() =>
	{
		if (prevbase != null)
		{
			prevbase = null;
			getTowerCoverage(MCC, MNC, currentSite.regionID, currentSite.siteID, 'FFFFFF', false);
		}
	});

	$('#map_select_layer').append($('<option>').text('Google Hybrid').val('google_hybrid'));
	$('#map_select_layer').append($('<option>').text('Google + Yandex Hybrid').val('google_yandex_hybrid'));
	$('#map_select_layer').append($('<option>').text('Yandex Map').val('yandex_map'));
	$('#map_select_layer').val($.cookie('mapType'));

	setTimeout(() =>
	{
		// Click events
		map.removeInteraction(select_interaction);
		select_interaction = new ol.interaction.Select();
		map.addInteraction(select_interaction);
		select_interaction.on("select", (e) =>
		{
			e.deselected.forEach((feature) =>
			{
			    if (typeof feature.isMoved === 'boolean')
            	{
					setVerifiedStyle(feature);
				}
			});

			if (e.selected.length === 0)
			{
				clearCoverage();
				prevbase = null;
				map.removeInteraction(currentTranslate);
				return;
			}

			e.selected.forEach((feature) =>
			{
			    if (feature.get("siteID") !== undefined)
            	{	// tower
            		if (feature.get("siteID") == prevbase)
            		{	// tower -> cell coverage -> tower
            			return;
            		}
        			getBaseStation(feature.get("MCC"), feature.get("MNC"), feature.get("LAC"), feature.get("base"));
	            	// move
	            	if (isLoggedIn)
	            	{
		                var translateMoveTower = new ol.interaction.Translate({
		                	features: new ol.Collection([feature])
						});
						
		                translateMoveTower.on('translatestart', function (e)
		                {
							startCoords = ol.proj.transform(feature.getGeometry().getCoordinates(), 'EPSG:3857', 'EPSG:4326'); // Sets global var to initial value when marker clicked for the first time.

							if (CoveragePolygonLayer != null)
								CoveragePolygonLayer.setOpacity(0.5);

							return true;
		                });

		                translateMoveTower.on('translateend', function (e)
		                {
							const coord = ol.proj.transform(feature.getGeometry().getCoordinates(), 'EPSG:3857', 'EPSG:4326');

							// checks that the difference between the start and the end coordinates of the translate event is large enough otherwise nothing happens.
							if (diff(coord[0], startCoords[0]) || diff(coord[1], startCoords[1]))
								handleTowerMove(feature, coord[1], coord[0]);

							if (CoveragePolygonLayer != null)
								CoveragePolygonLayer.setOpacity(1);

							return true;
		                });

		                // just enable drag'n'drop
		                if (currentTranslate != null)
		                {
		                	prevbase = null; // FIXME
		                	map.removeInteraction(currentTranslate);
		                }

		                map.addInteraction(translateMoveTower);
						currentTranslate = translateMoveTower;
	            	}
				}
				else if (feature.get("CID") !== undefined)
			    {	// cell coverage
					const cell = feature.get("CID").toString();
			        feature.setStyle(sectorStylesHighlighted[cell]);
					
					$('#tabs-2').animate(
					{
						scrollTop:
							$("#detailsTable" + cell).offset().top - 
							$("#tabs-2").offset().top +
							$("#tabs-2").scrollTop() -
							0.5
					}, 750, 'easeOutExpo');
			    }
			    else
				{	// all others
	                var translateMovePlacemark = new ol.interaction.Translate({
	                	features: new ol.Collection([feature])
					});
					
	                // just enable drag'n'drop
	                map.removeInteraction(currentTranslate);
	                map.addInteraction(translateMovePlacemark);
					currentTranslate = translateMovePlacemark;
				}
			});
		});

		// Wheel events
		document.querySelectorAll('#select_provider_table ul.chosen-results')
		.forEach((e) =>
		{
			e.onwheel = () => {};
		});
		
		document.oncontextmenu = () => { return true; };
		document.getElementById('map_canvas').oncontextmenu = () => { return false; };
		
		// Drag'n'drop events
		var dnd = 0;
		document.ondragenter = (e) =>
		{
			if (dnd++ < 1)
				document.getElementById('side_bottom').classList.add('droptarget');
		};

		document.ondragover = (e) =>
		{
			e.preventDefault();
			e.dataTransfer.dropEffect = "none";
		};
		
		document.ondragleave = (e) =>
		{
			e.preventDefault();

			if (--dnd < 1)
				document.getElementById('side_bottom').classList.remove('droptarget');
		};
	
		document.getElementById('side_bottom').ondragover = (e) =>
		{
			e.stopPropagation();
			e.preventDefault();

			if (e.dataTransfer.items.length !== 1
			||	e.dataTransfer.items[0].kind !== 'file')
				e.dataTransfer.dropEffect = "none";
		};
		
		document.getElementById('side_bottom').ondrop = (e) =>
		{
			e.stopPropagation();
			e.preventDefault();
			dnd = 0;
			
			document.getElementById('side_bottom').classList.remove('droptarget');
			
			const layers = map.getLayers();
			layers.forEach((l) =>
			{
				if (l !== undefined && typeof l.values_.kmlType !== 'undefined')
					layers.remove(l);
			});
			
			const reader = new FileReader();
	        reader.onload = (r) =>
	        {
				layers.push(new ol.layer.Vector({
					zIndex: 10,
					source: new ol.source.Vector({
					    url: reader.result,
					    format: new ol.format.KML({
							extractStyles: true,
							extractAttributes: true,
							crossOrigin: null,
					    }),
					}),
					kmlType: true,
				}));		
	        }
	        reader.readAsDataURL(e.dataTransfer.files[0]);
		};
	}, 250);

	if (document.readyState === 'complete')
	{   // Workarounds for late init
	    changeMapType(mapType);
	    updateMNClist();
	    setupRightClick();
	    document.querySelector("#NETSelect_chosen .chosen-search").remove();
	    document.querySelector("#BandSelect_chosen .chosen-search").remove();
	}
	
	console.log(`Patch ${VERSION} has been applied`);
}
})();
