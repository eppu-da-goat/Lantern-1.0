'use strict';
// Summary pages from Lantern 1.0 now live on Lantern Search.
location.replace('lantern://app/search.html?q=' + encodeURIComponent(new URLSearchParams(location.search).get('q') || '') + '&summary=1');
