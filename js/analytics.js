// Analytics events must be accepted by a rate-limited Cloudflare Worker before production use.
// The client deliberately does not increment Firestore counters.
export async function trackEvent(type,username,linkId){const endpoint=window.LINKORA_ANALYTICS_ENDPOINT;if(!endpoint)return false;try{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type,username,linkId,referrer:document.referrer,ts:Date.now()})});return response.ok;}catch{return false;}}
