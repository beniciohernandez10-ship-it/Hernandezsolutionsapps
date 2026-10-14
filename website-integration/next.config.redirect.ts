// Merge this ENTRY into the website's existing next.config redirects(); keep every existing entry.
//
// async redirects() {
//   return [
//     ...existingRedirects,
export const clientPortalRedirect = {
  source: "/client-portal",
  destination: "https://portal.thehernandezsolutions.com",
  permanent: false, // switch to true once the portal URL is final
};
//   ];
// }
