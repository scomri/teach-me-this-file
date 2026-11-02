// Whether the student is reading the end of the page: within `slack` pixels of its bottom. No React.
export const nearBottom = ({ scrollHeight, scrollTop, clientHeight }, slack = 80) => scrollHeight - scrollTop - clientHeight <= slack;
