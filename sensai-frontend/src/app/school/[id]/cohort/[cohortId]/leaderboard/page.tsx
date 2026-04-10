import { Metadata } from 'next';
import ClientLeaderboardView from './ClientLeaderboardView';
import { cookies } from 'next/headers';

export const metadata: Metadata = {
    title: 'Leaderboard',
    description: 'View the performance of all members in this cohort.',
};

async function getCohortName(cohortId: string) {
    try {
        const cookieStore = await cookies();
        // Replace with your actual API endpoint
        const res = await fetch(`${process.env.BACKEND_URL}/cohorts/${cohortId}`, {
            headers: {
                Cookie: cookieStore.toString()
            }
        });

        if (!res.ok) return null;

        const data = await res.json();
        return data.name;
    } catch (error) {
        console.error("Error fetching cohort name:", error);
        return null;
    }
}

export default async function LeaderboardPage(props: {
    params: Promise<{ id: string; cohortId: string }>;
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;

    // Fetch the cohort name on the server
    const cohortName = await getCohortName(params.cohortId);

    // Parse batchId from query params
    let batchId: number | null = null;
    if (searchParams && searchParams.batchId) {
        const batchIdStr = Array.isArray(searchParams.batchId) ? searchParams.batchId[0] : searchParams.batchId;
        const parsed = parseInt(batchIdStr, 10);
        if (!isNaN(parsed)) batchId = parsed;
    }

    return <ClientLeaderboardView
        cohortId={params.cohortId}
        cohortName={cohortName}
        view='learner'
        batchId={batchId}
    />;
} 