// Main entry point
import * as state from './state.js';
import { filterData } from './utils.js';
import { renderGraph } from './render.js';
import { initSearchListeners } from './search.js';
import { initFilterListeners } from './events.js';

// Apply filters and re-render
function applyFilters() {
    if (!state.rawData) return;
    const filteredData = filterData(state.rawData);
    renderGraph(filteredData);
}

// Initialize
async function init() {
    try {
        const [graphResponse, domainsResponse, groupsResponse] = await Promise.all([
            fetch('/api/graph'),
            fetch('/api/domains'),
            fetch('/api/message-groups'),
        ]);
        const rawData = await graphResponse.json();
        state.setRawData(rawData);

        // Build domain lookup maps
        const domainsData = await domainsResponse.json();
        const emailToDomain = {};
        const domainToEmails = {};
        for (const [domain, users] of Object.entries(domainsData.domain_groups || {})) {
            const emails = users.map(u => u.email);
            domainToEmails[domain] = emails;
            for (const email of emails) {
                emailToDomain[email] = domain;
            }
        }
        state.setEmailToDomain(emailToDomain);
        state.setDomainToEmails(domainToEmails);

        // Build message group lookup maps
        const groupsData = await groupsResponse.json();
        const emailToGroups = {};
        const groupToEmails = {};
        for (const [subject, emails] of Object.entries(groupsData.groups || {})) {
            groupToEmails[subject] = emails;
            for (const email of emails) {
                if (!emailToGroups[email]) emailToGroups[email] = [];
                emailToGroups[email].push(subject);
            }
        }
        state.setEmailToGroups(emailToGroups);
        state.setGroupToEmails(groupToEmails);

        document.getElementById('loading').style.display = 'none';

        // Update total stats
        document.getElementById('total-contacts').textContent = rawData.stats.totalContacts.toLocaleString();
        document.getElementById('total-received').textContent = rawData.stats.totalReceived.toLocaleString();
        document.getElementById('total-sent').textContent = rawData.stats.totalSent.toLocaleString();

        // Update slider max based on total contacts
        const slider = document.getElementById('contact-limit');
        slider.max = rawData.stats.totalContacts;

        // Initialize event listeners
        initFilterListeners(applyFilters);
        initSearchListeners();

        // Initial render
        applyFilters();

        // Re-render on window resize (reset transform to recenter)
        window.addEventListener('resize', () => {
            state.setCurrentTransform(d3.zoomIdentity);
            applyFilters();
        });

    } catch (error) {
        document.getElementById('loading').textContent = 'Loading error: ' + error.message;
        console.error('Error loading graph:', error);
    }
}

// Start
init();
