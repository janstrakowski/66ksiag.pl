/** True tylko poza produkcją — konsola nie montuje się na realnym hoście. */
export function isDevHost() {
  const h = location.hostname;
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "[::1]" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local")
  );
}
