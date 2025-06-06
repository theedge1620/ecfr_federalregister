document.getElementById('ecfrForm').addEventListener('submit', function(event) {
    event.preventDefault();
    const date = document.getElementById('date').value;
    const title = document.getElementById('title').value;
    const section = document.getElementById('section').value;
    fetchECFRData(date, title, section);
});

function findFRMatches(inputString) {
    // Define the regular expression pattern
    const regex = /\d{2} FR \d+/g;
    
    // Use the match method to find all matches
    const matches = inputString.match(regex);
    
    // Return the matches or an empty array if no matches are found
    return matches || [];
}



async function fetchECFRData(date, title, section) {
    const apiUrl = `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${title}.xml?section=${section}`;
    
    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/xml'
            }
        });

        if (!response.ok) {
            throw new Error(`Error: ${response.status}`);
        }

        const xmlText = await response.text();
        console.log(xmlText)
        parseAndDisplayXML(xmlText);
    } catch (error) {
        console.error('Error fetching eCFR data:', error);
    }
}


async function fetchFederalRegisterPDFs(inputString) {
    // Use the findMatches function to get all matching patterns
    const matches = findFRMatches(inputString);

    console.log(matches);
    // Check if there are any matches
    if (matches.length === 0) {
        console.log("No matches found.");
        return;
    }
    var queryString = '';
    var modifiedMatch = '';
    for (let kk=0; kk < matches.length; kk++) { // construct API string insert
        modifiedMatch = matches[kk].replaceAll(" ", "%");
        if (kk<matches.length-1) {
            queryString += modifiedMatch + ",";
        } else {
            queryString += modifiedMatch;
        }
    }

    // construct query string
    // example:  curl -X GET "https://www.federalregister.gov/api/v1/documents/88%20FR%2015880,48%20FR%2040882.json?fields[]=pdf_url" -H "accept: */*"
    const apiUrl = `https://www.federalregister.gov/api/v1/documents/${(queryString)}.json?fields[]=pdf_url`;
    console.log(queryString)
    https://www.federalregister.gov/api/v1/documents/48%FR%39046,48%FR%40882,55%FR%29194,56%FR%944,56%FR%23473,56%FR%40184,57%FR%41381,58%FR%67661,59%FR%14087,65%FR%63786,72%FR%49502,85%FR%65662,87%FR%20697,88%FR%15880.json?fields[]=pdf_url
    try {
        // Make the API request
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'accept': '*/*'
            }
        });

        // Check if the response is successful
        if (!response.ok) {
            throw new Error(`Error fetching data: ${response.statusText}`);
        }

        // Parse the JSON response
        const data = await response.json();

        // Check if there are any documents in the response
        if (data.results && data.results.length > 0) {
            // Get the URL of the first PDF document
            const pdfUrl = data.results.pdf_url;

            // Log the PDF URL
            console.log(`PDF URL for ${queryString}: ${pdfUrl}`);
            return data;
        } else {
            console.log(`No documents found for ${queryString}.`);
        }
    } catch (error) {
        console.error(`Error fetching PDF for ${queryString}: ${error.message}`);
    }
   
}

function extractTagText(xmlText,tagtext) {
    console.log(tagtext);
    if (tagtext === "CITA") {
        var headStartTag = '<'+tagtext+ ' TYPE="N">';
        var headEndTag = '</' + tagtext + '>';
    } else {
        var headStartTag = '<'+tagtext+'>';
        var headEndTag = '</' + tagtext + '>';
    }
    //console.log(headStartTag);
    const startIndex = xmlText.indexOf(headStartTag);
    const endIndex = xmlText.indexOf(headEndTag);
    
    if (startIndex !== -1 && endIndex !== -1) {
        return xmlText.substring(startIndex + headStartTag.length, endIndex).trim();
    } else {
        return tagtext + ' element not found';
    }
}





function parseAndDisplayXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');

    const headElement = extractTagText(xmlText,'HEAD');
    const pElements = xmlDoc.getElementsByTagName('P');
    const citaElement = extractTagText(xmlText,'CITA');

    let displayText = '';

    if (citaElement) {
        citaFRs = findFRMatches(citaElement);
        console.log(citaFRs);        
        displayText += `<h2>Citations</h2><p>${citaElement}</p>`;
        displayText += '<h2>Citation Links</h2><p>';
        for (let k=0;k<citaFRs.length;k++) {
            var modifiedMatch = citaFRs[k].replaceAll(" ", "-");
            var FRurl = `https://www.federalregister.gov/citation/${modifiedMatch}`
            displayText += `<a href = "${FRurl}" target="_blank">${citaFRs[k]}</a>, `;
        }
        displayText += '</p>'

    }
    
    if (headElement) {
        displayText += `<h2>Section</h2><p>${headElement}</p>`;
    }

    if (pElements.length > 0) {
        displayText += `<h2>Text</h2>`;
        for (let i = 0; i < pElements.length; i++) {
            displayText += `<p>${pElements[i].textContent}</p>`;
        }
    }

    

    document.getElementById('eCFRdiv').innerHTML = displayText;
}