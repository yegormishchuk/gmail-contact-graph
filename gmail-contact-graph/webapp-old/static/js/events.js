// Event listeners for filters
import { filters } from './state.js';

// Show filtered tab and switch to it
function showFilteredTab() {
    const filteredTab = document.getElementById('filtered-tab');
    const filteredList = document.getElementById('filtered-list');
    const rankingList = document.getElementById('ranking-list');
    const spamList = document.getElementById('spam-list');
    const tabs = document.querySelectorAll('.ranking-tab');

    // Show the filtered tab
    filteredTab.classList.remove('hidden');

    // Switch to filtered tab
    tabs.forEach(t => t.classList.remove('active'));
    filteredTab.classList.add('active');

    // Show filtered list, hide others
    rankingList.classList.add('hidden');
    spamList.classList.add('hidden');
    filteredList.classList.remove('hidden');
}

// Hide filtered tab and switch to ranking
function hideFilteredTab() {
    const filteredTab = document.getElementById('filtered-tab');
    const filteredList = document.getElementById('filtered-list');
    const rankingList = document.getElementById('ranking-list');
    const spamList = document.getElementById('spam-list');
    const tabs = document.querySelectorAll('.ranking-tab');

    // Hide the filtered tab
    filteredTab.classList.add('hidden');

    // Switch to ranking tab
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelector('.ranking-tab[data-tab="ranking"]').classList.add('active');

    // Show ranking list, hide others
    filteredList.classList.add('hidden');
    spamList.classList.add('hidden');
    rankingList.classList.remove('hidden');
}

// Initialize filter listeners with a callback for applying filters
export function initFilterListeners(applyFilters) {
    document.getElementById('contact-limit').addEventListener('input', (e) => {
        filters.limit = parseInt(e.target.value);
        document.getElementById('limit-value').textContent = filters.limit;
        applyFilters();
    });

    // Radio button filters
    document.querySelectorAll('input[name="filter-type"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            filters.filterType = e.target.value || null;
            applyFilters();
            showFilteredTab();
        });
    });

    // Clear filters button
    document.getElementById('clear-filters').addEventListener('click', () => {
        filters.filterType = null;
        document.querySelectorAll('input[name="filter-type"]').forEach(radio => {
            radio.checked = false;
        });
        applyFilters();
        hideFilteredTab();
    });
}
