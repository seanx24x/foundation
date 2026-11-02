export interface Profile {
  name: string;
  email: string;
  role: string;
  bio: string;
}

export async function saveProfile(profile: Profile, simulateError = false): Promise<void> {
  const response = await fetch('/api/orbit/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...profile, simulateError }),
  });
  if (!response.ok) {
    throw new Error('Your changes couldn’t be saved. Please try again.');
  }
}
