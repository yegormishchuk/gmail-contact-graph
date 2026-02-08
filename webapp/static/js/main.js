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

// Initialize ranking panel
async function initRankingPanel(rawData) {
    const panel = document.getElementById('ranking-panel');
    const rankingList = document.getElementById('ranking-list');
    const spamList = document.getElementById('spam-list');
    const toggleBtn = document.getElementById('ranking-toggle');
    const showBtn = document.getElementById('ranking-show-btn');
    const searchInput = document.getElementById('ranking-search');
    const tabs = document.querySelectorAll('.ranking-tab');

    // Sort contacts by composite score (excluding center node)
    const contacts = rawData.nodes
        .filter(n => !n.isCenter)
        .sort((a, b) => b.compositeScore - a.compositeScore);

    // Populate ranking list
    let currentPlace = 0;
    let prevScore = null;

    contacts.forEach((contact, index) => {
        // When score differs, place = position (1-based index)
        // When score is same, keep previous place (tie)
        if (prevScore !== contact.compositeScore) {
            currentPlace = index + 1;
        }
        prevScore = contact.compositeScore;

        const item = document.createElement('div');
        item.className = 'ranking-item';
        item.dataset.email = contact.email;
        item.dataset.name = contact.name.toLowerCase();

        const placeClass = currentPlace === 1 ? 'top-1' : currentPlace === 2 ? 'top-2' : currentPlace === 3 ? 'top-3' : '';

        item.innerHTML = `
            <span class="ranking-place ${placeClass}">${currentPlace}</span>
            <span class="ranking-name" title="${contact.name}">${contact.name}</span>
            <span class="ranking-score">${Math.round(contact.compositeScore)}</span>
        `;

        // Click to highlight contact on graph
        item.addEventListener('click', () => {
            const graphSearchInput = document.getElementById('contact-search');
            graphSearchInput.value = contact.email;
            graphSearchInput.dispatchEvent(new Event('input'));
            // Trigger search result click
            setTimeout(() => {
                const firstResult = document.querySelector('.search-result-item');
                if (firstResult) firstResult.click();
            }, 100);
        });

        rankingList.appendChild(item);
    });

    // Load and populate spam list
    try {
        const response = await fetch('/api/excluded-contacts');
        const excludedContacts = await response.json();

        excludedContacts.forEach(contact => {
            const item = document.createElement('div');
            item.className = 'spam-item';
            item.dataset.email = contact.email;
            item.dataset.name = contact.name.toLowerCase();
            item.innerHTML = `
                <span class="spam-name" title="${contact.email}">${contact.name}</span>
                <span class="spam-count">${contact.total}</span>
            `;
            spamList.appendChild(item);
        });
    } catch (err) {
        console.error('Failed to load excluded contacts:', err);
    }

    // Search filtering
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        const activeTab = document.querySelector('.ranking-tab.active').dataset.tab;
        const activeList = activeTab === 'ranking' ? rankingList : spamList;

        activeList.querySelectorAll('.ranking-item, .spam-item').forEach(item => {
            const name = item.dataset.name || '';
            const email = item.dataset.email || '';
            const matches = name.includes(query) || email.includes(query);
            item.style.display = matches ? '' : 'none';
        });
    });

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const tabName = tab.dataset.tab;
            if (tabName === 'ranking') {
                rankingList.classList.remove('hidden');
                spamList.classList.add('hidden');
            } else {
                rankingList.classList.add('hidden');
                spamList.classList.remove('hidden');
            }

            // Re-apply search filter for new tab
            searchInput.dispatchEvent(new Event('input'));
        });
    });

    // Toggle panel visibility
    toggleBtn.addEventListener('click', () => {
        panel.classList.add('hidden');
        showBtn.classList.remove('hidden');
    });

    showBtn.addEventListener('click', () => {
        panel.classList.remove('hidden');
        showBtn.classList.add('hidden');
    });
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
        initRankingPanel(rawData);

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
