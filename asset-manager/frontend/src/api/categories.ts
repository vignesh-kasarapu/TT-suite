import { apiClient } from './client';
import type {
  Category,
  CategoryCreatePayload,
  CategoryUpdatePayload,
} from '../types';

export async function listCategoriesApi(): Promise<Category[]> {
  const response = await apiClient.get<Category[]>('/categories');
  return response.data;
}

export async function createCategoryApi(
  payload: CategoryCreatePayload,
): Promise<Category> {
  const response = await apiClient.post<Category>('/categories', payload);
  return response.data;
}

export async function updateCategoryApi(
  id: number,
  payload: CategoryUpdatePayload,
): Promise<Category> {
  const response = await apiClient.patch<Category>(`/categories/${id}`, payload);
  return response.data;
}

export async function deleteCategoryApi(id: number): Promise<void> {
  await apiClient.delete(`/categories/${id}`);
}
