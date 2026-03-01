export type ServiceTestResult = {
    friendly: string;
    message: string;
    status: boolean;
};

export type ServiceTests = Record<string, ServiceTestResult>;

export type ServiceInstance = {
    protocol: string;
    tests: ServiceTests;
    codebase?: string;
    online: boolean;
    startTime: number;
    api: string;
    version: string;
    frontend?: string;
};

export type ServiceStatusResponse = {
    lastUpdatedUTC: string;
    data: ServiceInstance[];
};

export type ServiceStatusCache = {
    status: ServiceStatusResponse;
    fetchedAt: number;
};
