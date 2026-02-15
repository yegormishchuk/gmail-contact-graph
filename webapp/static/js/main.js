// Main entry point
import * as state from './state.js';
import { filters } from './state.js';
import { filterData } from './utils.js';
import { renderGraph } from './render.js';
import { initSearchListeners } from './search.js';
import { initFilterListeners } from './events.js';

// Update filtered ranking list
function updateFilteredList(filteredData) {
    const filteredList = document.getElementById('filtered-list');
    if (!filteredList) return;

    filteredList.innerHTML = '';

    // Get contacts excluding center node
    const contacts = filteredData.nodes.filter(n => !n.isCenter);

    if (contacts.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'filtered-empty';
        emptyMsg.textContent = filters.filterType ? 'No contacts match this filter' : 'Select a filter to see results';
        emptyMsg.style.cssText = 'padding: 12px; text-align: center; color: #666; font-size: 12px;';
        filteredList.appendChild(emptyMsg);
        return;
    }

    let currentPlace = 0;
    let prevScore = null;

    contacts.forEach((contact, index) => {
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
            setTimeout(() => {
                const firstResult = document.querySelector('.search-result-item');
                if (firstResult) firstResult.click();
            }, 100);
        });

        filteredList.appendChild(item);
    });
}

// Apply filters and re-render
function applyFilters() {
    if (!state.rawData) return;
    const filteredData = filterData(state.rawData);
    renderGraph(filteredData);
    updateFilteredList(filteredData);
}

// Initialize ranking panel
async function initRankingPanel(rawData) {
    const panel = document.getElementById('ranking-panel');
    const rankingList = document.getElementById('ranking-list');
    const filteredList = document.getElementById('filtered-list');
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
            <button class="ranking-delete" title="Remove contact">🗑</button>
        `;

        // Click to highlight contact on graph (only on name/place, not delete button)
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('ranking-delete')) return;
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
                <button class="spam-restore">not spam</button>
            `;
            spamList.appendChild(item);
        });
    } catch (err) {
        console.error('Failed to load excluded contacts:', err);
    }

    // Confirmation modal for delete
    const confirmModal = document.getElementById('confirm-modal');
    const confirmContactName = document.getElementById('confirm-contact-name');
    const confirmCancelBtn = document.getElementById('confirm-cancel');
    const confirmDeleteBtn = document.getElementById('confirm-delete');
    const confirmDontShow = document.getElementById('confirm-dont-show');
    let pendingDeleteContact = null;

    const SKIP_CONFIRM_KEY = 'skipDeleteConfirmation';

    function shouldSkipConfirmation() {
        return localStorage.getItem(SKIP_CONFIRM_KEY) === 'true';
    }

    function showConfirmModal(contact) {
        pendingDeleteContact = contact;
        confirmContactName.textContent = contact.name;
        confirmDontShow.checked = false;
        confirmModal.classList.remove('hidden');
    }

    function hideConfirmModal() {
        confirmModal.classList.add('hidden');
        pendingDeleteContact = null;
    }

    confirmCancelBtn.addEventListener('click', hideConfirmModal);
    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) hideConfirmModal();
    });

    async function deleteContact(contact) {
        try {
            const response = await fetch('/api/contacts/mark-not-human', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: contact.email })
            });

            if (response.ok) {
                // Remove from state
                state.removeContact(contact.email);

                // Remove node from graph if visible
                if (state.currentSvg) {
                    state.currentSvg.selectAll('.node').filter(n => n.email === contact.email).remove();
                    state.currentSvg.selectAll('.label').filter(n => n.email === contact.email).remove();
                }

                // Remove from simulation
                if (state.currentSimulation) {
                    const nodes = state.currentSimulation.nodes();
                    const filtered = nodes.filter(n => n.email !== contact.email);
                    state.currentSimulation.nodes(filtered);
                }

                // Remove from ranking list and recalculate places
                const rankingItem = document.querySelector(`.ranking-item[data-email="${contact.email}"]`);
                if (rankingItem) {
                    rankingItem.remove();

                    // Recalculate all ranking places
                    const items = Array.from(rankingList.querySelectorAll('.ranking-item'));
                    const itemsWithScores = items.map(item => ({
                        element: item,
                        score: parseInt(item.querySelector('.ranking-score').textContent, 10)
                    }));

                    let currentPlace = 0;
                    let prevScore = null;

                    itemsWithScores.forEach((item, index) => {
                        if (prevScore !== item.score) {
                            currentPlace = index + 1;
                        }
                        prevScore = item.score;

                        const placeEl = item.element.querySelector('.ranking-place');
                        placeEl.textContent = currentPlace;
                        placeEl.className = 'ranking-place';
                        if (currentPlace === 1) placeEl.classList.add('top-1');
                        else if (currentPlace === 2) placeEl.classList.add('top-2');
                        else if (currentPlace === 3) placeEl.classList.add('top-3');
                    });
                }

                // Add to spam list
                const spamItem = document.createElement('div');
                spamItem.className = 'spam-item';
                spamItem.dataset.email = contact.email;
                spamItem.dataset.name = contact.name.toLowerCase();
                spamItem.innerHTML = `
                    <span class="spam-name" title="${contact.email}">${contact.name}</span>
                    <span class="spam-count">${contact.total}</span>
                    <button class="spam-restore">not spam</button>
                `;
                spamList.insertBefore(spamItem, spamList.firstChild);

                // Update displayed contacts count
                const displayedEl = document.getElementById('displayed-contacts');
                const current = parseInt(displayedEl.textContent.replace(/,/g, ''), 10);
                if (!isNaN(current)) {
                    displayedEl.textContent = (current - 1).toLocaleString();
                }

                // Update total contacts count
                const totalEl = document.getElementById('total-contacts');
                const total = parseInt(totalEl.textContent.replace(/,/g, ''), 10);
                if (!isNaN(total)) {
                    totalEl.textContent = (total - 1).toLocaleString();
                }
            }
        } catch (err) {
            console.error('Failed to mark contact as not human:', err);
        }
    }

    confirmDeleteBtn.addEventListener('click', async () => {
        if (!pendingDeleteContact) return;

        // Save preference if checkbox is checked
        if (confirmDontShow.checked) {
            localStorage.setItem(SKIP_CONFIRM_KEY, 'true');
        }

        const contact = pendingDeleteContact;
        hideConfirmModal();
        await deleteContact(contact);
    });

    // Event delegation for delete buttons on ranking items
    rankingList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('ranking-delete')) {
            e.stopPropagation();
            const item = e.target.closest('.ranking-item');
            if (!item) return;

            const email = item.dataset.email;
            const name = item.querySelector('.ranking-name').textContent;

            // Find the contact in rawData to get the total
            const contact = rawData.nodes.find(n => n.email === email);
            const total = contact ? (contact.received || 0) + (contact.sent || 0) : 0;

            // Skip confirmation if user chose "don't show again"
            if (shouldSkipConfirmation()) {
                await deleteContact({ email, name, total });
            } else {
                showConfirmModal({ email, name, total });
            }
        }
    });

    // Event delegation for restore buttons on spam items
    spamList.addEventListener('click', async (e) => {
        if (e.target.classList.contains('spam-restore')) {
            e.stopPropagation();
            const item = e.target.closest('.spam-item');
            if (!item) return;

            const email = item.dataset.email;

            try {
                const response = await fetch('/api/contacts/restore', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });

                if (response.ok) {
                    // Reload page to get fresh data with recalculated rankings
                    window.location.reload();
                }
            } catch (err) {
                console.error('Failed to restore contact:', err);
            }
        }
    });

    // Search filtering
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        const activeTab = document.querySelector('.ranking-tab.active').dataset.tab;
        let activeList;
        if (activeTab === 'ranking') activeList = rankingList;
        else if (activeTab === 'filtered') activeList = filteredList;
        else activeList = spamList;

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
            rankingList.classList.add('hidden');
            filteredList.classList.add('hidden');
            spamList.classList.add('hidden');

            if (tabName === 'ranking') {
                rankingList.classList.remove('hidden');
            } else if (tabName === 'filtered') {
                filteredList.classList.remove('hidden');
            } else {
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
