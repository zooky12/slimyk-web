#define ICALL_TABLE_corlib 1

static int corlib_icall_indexes [] = {
161,
174,
175,
176,
177,
178,
179,
180,
181,
182,
185,
186,
187,
359,
360,
361,
389,
390,
391,
418,
419,
420,
537,
538,
539,
542,
576,
577,
578,
581,
583,
585,
587,
592,
600,
601,
602,
603,
604,
605,
606,
607,
608,
609,
610,
611,
612,
613,
614,
615,
616,
618,
619,
620,
621,
622,
623,
624,
720,
721,
722,
723,
724,
725,
726,
727,
728,
729,
730,
731,
732,
733,
734,
735,
736,
738,
739,
740,
741,
742,
743,
744,
806,
815,
816,
886,
893,
896,
898,
903,
904,
906,
907,
911,
912,
914,
915,
918,
919,
920,
923,
925,
928,
930,
932,
941,
1007,
1009,
1011,
1021,
1022,
1023,
1025,
1031,
1032,
1033,
1034,
1035,
1043,
1044,
1045,
1049,
1050,
1052,
1056,
1057,
1058,
1355,
1543,
1544,
9163,
9164,
9166,
9167,
9168,
9169,
9170,
9172,
9173,
9174,
9175,
9193,
9195,
9200,
9202,
9204,
9206,
9257,
9258,
9260,
9261,
9262,
9263,
9264,
9266,
9268,
10292,
10296,
10298,
10299,
10300,
10301,
10740,
10741,
10742,
10743,
10761,
10762,
10763,
10866,
10869,
10877,
10878,
10879,
10880,
10881,
11181,
11182,
11187,
11188,
11218,
11244,
11251,
11258,
11269,
11272,
11297,
11383,
11385,
11386,
11392,
11400,
11419,
11420,
11428,
11430,
11437,
11438,
11441,
11443,
11447,
11453,
11454,
11461,
11463,
11475,
11478,
11479,
11480,
11491,
11501,
11507,
11508,
11509,
11511,
11512,
11528,
11530,
11544,
11565,
11566,
11591,
11596,
11625,
11626,
12182,
12196,
12282,
12283,
12502,
12503,
12510,
12511,
12512,
12518,
12587,
13050,
13051,
13309,
13313,
13323,
14160,
14181,
14183,
14185,
};
void ves_icall_System_Array_InternalCreate (int,int,int,int,int);
int ves_icall_System_Array_GetCorElementTypeOfElementTypeInternal (int);
int ves_icall_System_Array_IsValueOfElementTypeInternal (int,int);
int ves_icall_System_Array_CanChangePrimitive (int,int,int);
int ves_icall_System_Array_FastCopy (int,int,int,int,int);
int ves_icall_System_Array_GetLengthInternal_raw (int,int,int);
int ves_icall_System_Array_GetLowerBoundInternal_raw (int,int,int);
void ves_icall_System_Array_GetGenericValue_icall (int,int,int);
void ves_icall_System_Array_GetValueImpl_raw (int,int,int,int);
void ves_icall_System_Array_SetGenericValue_icall (int,int,int);
void ves_icall_System_Array_SetValueImpl_raw (int,int,int,int);
void ves_icall_System_Array_InitializeInternal_raw (int,int);
void ves_icall_System_Array_SetValueRelaxedImpl_raw (int,int,int,int);
void ves_icall_System_Runtime_RuntimeImports_ZeroMemory (int,int);
void ves_icall_System_Runtime_RuntimeImports_Memmove (int,int,int);
void ves_icall_System_Buffer_BulkMoveWithWriteBarrier (int,int,int,int);
int ves_icall_System_Delegate_AllocDelegateLike_internal_raw (int,int);
int ves_icall_System_Delegate_CreateDelegate_internal_raw (int,int,int,int,int);
int ves_icall_System_Delegate_GetVirtualMethod_internal_raw (int,int);
void ves_icall_System_Enum_GetEnumValuesAndNames_raw (int,int,int,int);
int ves_icall_System_Enum_InternalGetCorElementType (int);
void ves_icall_System_Enum_InternalGetUnderlyingType_raw (int,int,int);
int ves_icall_System_Environment_get_ProcessorCount ();
int ves_icall_System_Environment_get_TickCount ();
int64_t ves_icall_System_Environment_get_TickCount64 ();
void ves_icall_System_Environment_FailFast_raw (int,int,int,int);
int ves_icall_System_GC_GetCollectionCount (int);
void ves_icall_System_GC_register_ephemeron_array_raw (int,int);
int ves_icall_System_GC_get_ephemeron_tombstone_raw (int);
void ves_icall_System_GC_SuppressFinalize_raw (int,int);
void ves_icall_System_GC_ReRegisterForFinalize_raw (int,int);
void ves_icall_System_GC_GetGCMemoryInfo (int,int,int,int,int,int);
int ves_icall_System_GC_AllocPinnedArray_raw (int,int,int);
int ves_icall_System_Object_MemberwiseClone_raw (int,int);
double ves_icall_System_Math_Acos (double);
double ves_icall_System_Math_Acosh (double);
double ves_icall_System_Math_Asin (double);
double ves_icall_System_Math_Asinh (double);
double ves_icall_System_Math_Atan (double);
double ves_icall_System_Math_Atan2 (double,double);
double ves_icall_System_Math_Atanh (double);
double ves_icall_System_Math_Cbrt (double);
double ves_icall_System_Math_Ceiling (double);
double ves_icall_System_Math_Cos (double);
double ves_icall_System_Math_Cosh (double);
double ves_icall_System_Math_Exp (double);
double ves_icall_System_Math_Floor (double);
double ves_icall_System_Math_Log (double);
double ves_icall_System_Math_Log10 (double);
double ves_icall_System_Math_Pow (double,double);
double ves_icall_System_Math_Sin (double);
double ves_icall_System_Math_Sinh (double);
double ves_icall_System_Math_Sqrt (double);
double ves_icall_System_Math_Tan (double);
double ves_icall_System_Math_Tanh (double);
double ves_icall_System_Math_FusedMultiplyAdd (double,double,double);
double ves_icall_System_Math_Log2 (double);
double ves_icall_System_Math_ModF (double,int);
float ves_icall_System_MathF_Acos (float);
float ves_icall_System_MathF_Acosh (float);
float ves_icall_System_MathF_Asin (float);
float ves_icall_System_MathF_Asinh (float);
float ves_icall_System_MathF_Atan (float);
float ves_icall_System_MathF_Atan2 (float,float);
float ves_icall_System_MathF_Atanh (float);
float ves_icall_System_MathF_Cbrt (float);
float ves_icall_System_MathF_Ceiling (float);
float ves_icall_System_MathF_Cos (float);
float ves_icall_System_MathF_Cosh (float);
float ves_icall_System_MathF_Exp (float);
float ves_icall_System_MathF_Floor (float);
float ves_icall_System_MathF_Log (float);
float ves_icall_System_MathF_Log10 (float);
float ves_icall_System_MathF_Pow (float,float);
float ves_icall_System_MathF_Sin (float);
float ves_icall_System_MathF_Sinh (float);
float ves_icall_System_MathF_Sqrt (float);
float ves_icall_System_MathF_Tan (float);
float ves_icall_System_MathF_Tanh (float);
float ves_icall_System_MathF_FusedMultiplyAdd (float,float,float);
float ves_icall_System_MathF_Log2 (float);
float ves_icall_System_MathF_ModF (float,int);
int ves_icall_RuntimeMethodHandle_GetFunctionPointer_raw (int,int);
void ves_icall_RuntimeMethodHandle_ReboxFromNullable_raw (int,int,int);
void ves_icall_RuntimeMethodHandle_ReboxToNullable_raw (int,int,int,int);
int ves_icall_RuntimeType_GetCorrespondingInflatedMethod_raw (int,int,int);
void ves_icall_RuntimeType_make_array_type_raw (int,int,int,int);
void ves_icall_RuntimeType_make_byref_type_raw (int,int,int);
void ves_icall_RuntimeType_make_pointer_type_raw (int,int,int);
void ves_icall_RuntimeType_MakeGenericType_raw (int,int,int,int);
int ves_icall_RuntimeType_GetMethodsByName_native_raw (int,int,int,int,int);
int ves_icall_RuntimeType_GetPropertiesByName_native_raw (int,int,int,int,int);
int ves_icall_RuntimeType_GetConstructors_native_raw (int,int,int);
int ves_icall_System_RuntimeType_CreateInstanceInternal_raw (int,int);
void ves_icall_RuntimeType_GetDeclaringMethod_raw (int,int,int);
void ves_icall_System_RuntimeType_getFullName_raw (int,int,int,int,int);
void ves_icall_RuntimeType_GetGenericArgumentsInternal_raw (int,int,int,int);
int ves_icall_RuntimeType_GetGenericParameterPosition (int);
int ves_icall_RuntimeType_GetEvents_native_raw (int,int,int,int);
int ves_icall_RuntimeType_GetFields_native_raw (int,int,int,int,int);
void ves_icall_RuntimeType_GetInterfaces_raw (int,int,int);
int ves_icall_RuntimeType_GetNestedTypes_native_raw (int,int,int,int,int);
void ves_icall_RuntimeType_GetDeclaringType_raw (int,int,int);
void ves_icall_RuntimeType_GetName_raw (int,int,int);
void ves_icall_RuntimeType_GetNamespace_raw (int,int,int);
int ves_icall_RuntimeType_FunctionPointerReturnAndParameterTypes_raw (int,int);
int ves_icall_RuntimeTypeHandle_GetAttributes (int);
int ves_icall_RuntimeTypeHandle_GetMetadataToken_raw (int,int);
void ves_icall_RuntimeTypeHandle_GetGenericTypeDefinition_impl_raw (int,int,int);
int ves_icall_RuntimeTypeHandle_GetCorElementType (int);
int ves_icall_RuntimeTypeHandle_HasInstantiation (int);
int ves_icall_RuntimeTypeHandle_IsInstanceOfType_raw (int,int,int);
int ves_icall_RuntimeTypeHandle_HasReferences_raw (int,int);
int ves_icall_RuntimeTypeHandle_GetArrayRank_raw (int,int);
void ves_icall_RuntimeTypeHandle_GetAssembly_raw (int,int,int);
void ves_icall_RuntimeTypeHandle_GetElementType_raw (int,int,int);
void ves_icall_RuntimeTypeHandle_GetModule_raw (int,int,int);
void ves_icall_RuntimeTypeHandle_GetBaseType_raw (int,int,int);
int ves_icall_RuntimeTypeHandle_type_is_assignable_from_raw (int,int,int);
int ves_icall_RuntimeTypeHandle_IsGenericTypeDefinition (int);
int ves_icall_RuntimeTypeHandle_GetGenericParameterInfo_raw (int,int);
int ves_icall_RuntimeTypeHandle_is_subclass_of_raw (int,int,int);
int ves_icall_RuntimeTypeHandle_IsByRefLike_raw (int,int);
void ves_icall_System_RuntimeTypeHandle_internal_from_name_raw (int,int,int,int,int,int);
int ves_icall_System_String_FastAllocateString_raw (int,int);
int ves_icall_System_String_InternalIsInterned_raw (int,int);
int ves_icall_System_String_InternalIntern_raw (int,int);
int ves_icall_System_Type_internal_from_handle_raw (int,int);
int ves_icall_System_ValueType_InternalGetHashCode_raw (int,int,int);
int ves_icall_System_ValueType_Equals_raw (int,int,int,int);
int ves_icall_System_Threading_Interlocked_CompareExchange_Int (int,int,int);
void ves_icall_System_Threading_Interlocked_CompareExchange_Object (int,int,int,int);
int ves_icall_System_Threading_Interlocked_Decrement_Int (int);
int ves_icall_System_Threading_Interlocked_Increment_Int (int);
int64_t ves_icall_System_Threading_Interlocked_Increment_Long (int);
int ves_icall_System_Threading_Interlocked_Exchange_Int (int,int);
void ves_icall_System_Threading_Interlocked_Exchange_Object (int,int,int);
int64_t ves_icall_System_Threading_Interlocked_CompareExchange_Long (int,int64_t,int64_t);
int64_t ves_icall_System_Threading_Interlocked_Exchange_Long (int,int64_t);
int ves_icall_System_Threading_Interlocked_Add_Int (int,int);
int64_t ves_icall_System_Threading_Interlocked_Add_Long (int,int64_t);
void ves_icall_System_Threading_Monitor_Monitor_Enter_raw (int,int);
void mono_monitor_exit_icall_raw (int,int);
void ves_icall_System_Threading_Monitor_Monitor_pulse_raw (int,int);
void ves_icall_System_Threading_Monitor_Monitor_pulse_all_raw (int,int);
int ves_icall_System_Threading_Monitor_Monitor_wait_raw (int,int,int,int);
void ves_icall_System_Threading_Monitor_Monitor_try_enter_with_atomic_var_raw (int,int,int,int,int);
void ves_icall_System_Threading_Thread_InitInternal_raw (int,int);
int ves_icall_System_Threading_Thread_GetCurrentThread ();
void ves_icall_System_Threading_InternalThread_Thread_free_internal_raw (int,int);
int ves_icall_System_Threading_Thread_GetState_raw (int,int);
void ves_icall_System_Threading_Thread_SetState_raw (int,int,int);
void ves_icall_System_Threading_Thread_ClrState_raw (int,int,int);
void ves_icall_System_Threading_Thread_SetName_icall_raw (int,int,int,int);
int ves_icall_System_Threading_Thread_YieldInternal ();
void ves_icall_System_Threading_Thread_SetPriority_raw (int,int,int);
void ves_icall_System_Runtime_Loader_AssemblyLoadContext_PrepareForAssemblyLoadContextRelease_raw (int,int,int);
int ves_icall_System_Runtime_Loader_AssemblyLoadContext_GetLoadContextForAssembly_raw (int,int);
int ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalLoadFile_raw (int,int,int,int);
int ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalInitializeNativeALC_raw (int,int,int,int,int);
int ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalLoadFromStream_raw (int,int,int,int,int,int);
int ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalGetLoadedAssemblies_raw (int);
int ves_icall_System_GCHandle_InternalAlloc_raw (int,int,int);
void ves_icall_System_GCHandle_InternalFree_raw (int,int);
int ves_icall_System_GCHandle_InternalGet_raw (int,int);
void ves_icall_System_GCHandle_InternalSet_raw (int,int,int);
int ves_icall_System_Runtime_InteropServices_Marshal_GetLastPInvokeError ();
void ves_icall_System_Runtime_InteropServices_Marshal_SetLastPInvokeError (int);
void ves_icall_System_Runtime_InteropServices_Marshal_StructureToPtr_raw (int,int,int,int);
int ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_InternalGetHashCode_raw (int,int);
int ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_GetObjectValue_raw (int,int);
int ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_GetUninitializedObjectInternal_raw (int,int);
void ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_InitializeArray_raw (int,int,int);
int ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_GetSpanDataFrom_raw (int,int,int,int);
int ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_SufficientExecutionStack ();
int ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_InternalBox_raw (int,int,int);
int ves_icall_System_Reflection_Assembly_GetExecutingAssembly_raw (int,int);
int ves_icall_System_Reflection_Assembly_GetEntryAssembly_raw (int);
int ves_icall_System_Reflection_Assembly_InternalLoad_raw (int,int,int,int);
int ves_icall_System_Reflection_Assembly_InternalGetType_raw (int,int,int,int,int,int);
int ves_icall_System_Reflection_AssemblyName_GetNativeName (int);
int ves_icall_MonoCustomAttrs_GetCustomAttributesInternal_raw (int,int,int,int);
int ves_icall_MonoCustomAttrs_GetCustomAttributesDataInternal_raw (int,int);
int ves_icall_MonoCustomAttrs_IsDefinedInternal_raw (int,int,int);
int ves_icall_System_Reflection_FieldInfo_internal_from_handle_type_raw (int,int,int);
int ves_icall_System_Reflection_FieldInfo_get_marshal_info_raw (int,int);
int ves_icall_System_Reflection_LoaderAllocatorScout_Destroy (int);
void ves_icall_System_Reflection_RuntimeAssembly_GetInfo_raw (int,int,int,int);
void ves_icall_System_Reflection_Assembly_GetManifestModuleInternal_raw (int,int,int);
void ves_icall_System_Reflection_RuntimeAssembly_GetModulesInternal_raw (int,int,int);
void ves_icall_System_Reflection_RuntimeCustomAttributeData_ResolveArgumentsInternal_raw (int,int,int,int,int,int,int);
void ves_icall_RuntimeEventInfo_get_event_info_raw (int,int,int);
int ves_icall_reflection_get_token_raw (int,int);
int ves_icall_System_Reflection_EventInfo_internal_from_handle_type_raw (int,int,int);
int ves_icall_RuntimeFieldInfo_ResolveType_raw (int,int);
int ves_icall_RuntimeFieldInfo_GetParentType_raw (int,int,int);
int ves_icall_RuntimeFieldInfo_GetFieldOffset_raw (int,int);
int ves_icall_RuntimeFieldInfo_GetValueInternal_raw (int,int,int);
void ves_icall_RuntimeFieldInfo_SetValueInternal_raw (int,int,int,int);
int ves_icall_RuntimeFieldInfo_GetRawConstantValue_raw (int,int);
int ves_icall_reflection_get_token_raw (int,int);
void ves_icall_get_method_info_raw (int,int,int);
int ves_icall_get_method_attributes (int);
int ves_icall_System_Reflection_MonoMethodInfo_get_parameter_info_raw (int,int,int);
int ves_icall_System_MonoMethodInfo_get_retval_marshal_raw (int,int);
int ves_icall_System_Reflection_RuntimeMethodInfo_GetMethodFromHandleInternalType_native_raw (int,int,int,int);
int ves_icall_RuntimeMethodInfo_get_name_raw (int,int);
int ves_icall_RuntimeMethodInfo_get_base_method_raw (int,int,int);
int ves_icall_reflection_get_token_raw (int,int);
int ves_icall_InternalInvoke_raw (int,int,int,int,int);
void ves_icall_RuntimeMethodInfo_GetPInvoke_raw (int,int,int,int,int);
int ves_icall_RuntimeMethodInfo_MakeGenericMethod_impl_raw (int,int,int);
int ves_icall_RuntimeMethodInfo_GetGenericArguments_raw (int,int);
int ves_icall_RuntimeMethodInfo_GetGenericMethodDefinition_raw (int,int);
int ves_icall_RuntimeMethodInfo_get_IsGenericMethodDefinition_raw (int,int);
int ves_icall_RuntimeMethodInfo_get_IsGenericMethod_raw (int,int);
void ves_icall_InvokeClassConstructor_raw (int,int);
int ves_icall_InternalInvoke_raw (int,int,int,int,int);
int ves_icall_reflection_get_token_raw (int,int);
void ves_icall_System_Reflection_RuntimeModule_GetGuidInternal_raw (int,int,int);
int ves_icall_System_Reflection_RuntimeModule_ResolveMethodToken_raw (int,int,int,int,int,int);
int ves_icall_RuntimeParameterInfo_GetTypeModifiers_raw (int,int,int,int,int,int);
void ves_icall_RuntimePropertyInfo_get_property_info_raw (int,int,int,int);
int ves_icall_reflection_get_token_raw (int,int);
int ves_icall_System_Reflection_RuntimePropertyInfo_internal_from_handle_type_raw (int,int,int);
int ves_icall_CustomAttributeBuilder_GetBlob_raw (int,int,int,int,int,int,int,int);
void ves_icall_DynamicMethod_create_dynamic_method_raw (int,int,int,int,int);
void ves_icall_AssemblyBuilder_basic_init_raw (int,int);
void ves_icall_AssemblyBuilder_UpdateNativeCustomAttributes_raw (int,int);
void ves_icall_ModuleBuilder_basic_init_raw (int,int);
void ves_icall_ModuleBuilder_set_wrappers_type_raw (int,int,int);
int ves_icall_ModuleBuilder_getUSIndex_raw (int,int,int);
int ves_icall_ModuleBuilder_getToken_raw (int,int,int,int);
int ves_icall_ModuleBuilder_getMethodToken_raw (int,int,int,int);
void ves_icall_ModuleBuilder_RegisterToken_raw (int,int,int,int);
int ves_icall_TypeBuilder_create_runtime_class_raw (int,int);
int ves_icall_System_IO_Stream_HasOverriddenBeginEndRead_raw (int,int);
int ves_icall_System_IO_Stream_HasOverriddenBeginEndWrite_raw (int,int);
int ves_icall_System_Diagnostics_Debugger_IsAttached_internal ();
int ves_icall_System_Diagnostics_StackFrame_GetFrameInfo (int,int,int,int,int,int,int,int);
void ves_icall_System_Diagnostics_StackTrace_GetTrace (int,int,int,int);
int ves_icall_Mono_RuntimeClassHandle_GetTypeFromClass (int);
void ves_icall_Mono_RuntimeGPtrArrayHandle_GPtrArrayFree (int);
int ves_icall_Mono_SafeStringMarshal_StringToUtf8 (int);
void ves_icall_Mono_SafeStringMarshal_GFree (int);
static void *corlib_icall_funcs [] = {
// token 161,
ves_icall_System_Array_InternalCreate,
// token 174,
ves_icall_System_Array_GetCorElementTypeOfElementTypeInternal,
// token 175,
ves_icall_System_Array_IsValueOfElementTypeInternal,
// token 176,
ves_icall_System_Array_CanChangePrimitive,
// token 177,
ves_icall_System_Array_FastCopy,
// token 178,
ves_icall_System_Array_GetLengthInternal_raw,
// token 179,
ves_icall_System_Array_GetLowerBoundInternal_raw,
// token 180,
ves_icall_System_Array_GetGenericValue_icall,
// token 181,
ves_icall_System_Array_GetValueImpl_raw,
// token 182,
ves_icall_System_Array_SetGenericValue_icall,
// token 185,
ves_icall_System_Array_SetValueImpl_raw,
// token 186,
ves_icall_System_Array_InitializeInternal_raw,
// token 187,
ves_icall_System_Array_SetValueRelaxedImpl_raw,
// token 359,
ves_icall_System_Runtime_RuntimeImports_ZeroMemory,
// token 360,
ves_icall_System_Runtime_RuntimeImports_Memmove,
// token 361,
ves_icall_System_Buffer_BulkMoveWithWriteBarrier,
// token 389,
ves_icall_System_Delegate_AllocDelegateLike_internal_raw,
// token 390,
ves_icall_System_Delegate_CreateDelegate_internal_raw,
// token 391,
ves_icall_System_Delegate_GetVirtualMethod_internal_raw,
// token 418,
ves_icall_System_Enum_GetEnumValuesAndNames_raw,
// token 419,
ves_icall_System_Enum_InternalGetCorElementType,
// token 420,
ves_icall_System_Enum_InternalGetUnderlyingType_raw,
// token 537,
ves_icall_System_Environment_get_ProcessorCount,
// token 538,
ves_icall_System_Environment_get_TickCount,
// token 539,
ves_icall_System_Environment_get_TickCount64,
// token 542,
ves_icall_System_Environment_FailFast_raw,
// token 576,
ves_icall_System_GC_GetCollectionCount,
// token 577,
ves_icall_System_GC_register_ephemeron_array_raw,
// token 578,
ves_icall_System_GC_get_ephemeron_tombstone_raw,
// token 581,
ves_icall_System_GC_SuppressFinalize_raw,
// token 583,
ves_icall_System_GC_ReRegisterForFinalize_raw,
// token 585,
ves_icall_System_GC_GetGCMemoryInfo,
// token 587,
ves_icall_System_GC_AllocPinnedArray_raw,
// token 592,
ves_icall_System_Object_MemberwiseClone_raw,
// token 600,
ves_icall_System_Math_Acos,
// token 601,
ves_icall_System_Math_Acosh,
// token 602,
ves_icall_System_Math_Asin,
// token 603,
ves_icall_System_Math_Asinh,
// token 604,
ves_icall_System_Math_Atan,
// token 605,
ves_icall_System_Math_Atan2,
// token 606,
ves_icall_System_Math_Atanh,
// token 607,
ves_icall_System_Math_Cbrt,
// token 608,
ves_icall_System_Math_Ceiling,
// token 609,
ves_icall_System_Math_Cos,
// token 610,
ves_icall_System_Math_Cosh,
// token 611,
ves_icall_System_Math_Exp,
// token 612,
ves_icall_System_Math_Floor,
// token 613,
ves_icall_System_Math_Log,
// token 614,
ves_icall_System_Math_Log10,
// token 615,
ves_icall_System_Math_Pow,
// token 616,
ves_icall_System_Math_Sin,
// token 618,
ves_icall_System_Math_Sinh,
// token 619,
ves_icall_System_Math_Sqrt,
// token 620,
ves_icall_System_Math_Tan,
// token 621,
ves_icall_System_Math_Tanh,
// token 622,
ves_icall_System_Math_FusedMultiplyAdd,
// token 623,
ves_icall_System_Math_Log2,
// token 624,
ves_icall_System_Math_ModF,
// token 720,
ves_icall_System_MathF_Acos,
// token 721,
ves_icall_System_MathF_Acosh,
// token 722,
ves_icall_System_MathF_Asin,
// token 723,
ves_icall_System_MathF_Asinh,
// token 724,
ves_icall_System_MathF_Atan,
// token 725,
ves_icall_System_MathF_Atan2,
// token 726,
ves_icall_System_MathF_Atanh,
// token 727,
ves_icall_System_MathF_Cbrt,
// token 728,
ves_icall_System_MathF_Ceiling,
// token 729,
ves_icall_System_MathF_Cos,
// token 730,
ves_icall_System_MathF_Cosh,
// token 731,
ves_icall_System_MathF_Exp,
// token 732,
ves_icall_System_MathF_Floor,
// token 733,
ves_icall_System_MathF_Log,
// token 734,
ves_icall_System_MathF_Log10,
// token 735,
ves_icall_System_MathF_Pow,
// token 736,
ves_icall_System_MathF_Sin,
// token 738,
ves_icall_System_MathF_Sinh,
// token 739,
ves_icall_System_MathF_Sqrt,
// token 740,
ves_icall_System_MathF_Tan,
// token 741,
ves_icall_System_MathF_Tanh,
// token 742,
ves_icall_System_MathF_FusedMultiplyAdd,
// token 743,
ves_icall_System_MathF_Log2,
// token 744,
ves_icall_System_MathF_ModF,
// token 806,
ves_icall_RuntimeMethodHandle_GetFunctionPointer_raw,
// token 815,
ves_icall_RuntimeMethodHandle_ReboxFromNullable_raw,
// token 816,
ves_icall_RuntimeMethodHandle_ReboxToNullable_raw,
// token 886,
ves_icall_RuntimeType_GetCorrespondingInflatedMethod_raw,
// token 893,
ves_icall_RuntimeType_make_array_type_raw,
// token 896,
ves_icall_RuntimeType_make_byref_type_raw,
// token 898,
ves_icall_RuntimeType_make_pointer_type_raw,
// token 903,
ves_icall_RuntimeType_MakeGenericType_raw,
// token 904,
ves_icall_RuntimeType_GetMethodsByName_native_raw,
// token 906,
ves_icall_RuntimeType_GetPropertiesByName_native_raw,
// token 907,
ves_icall_RuntimeType_GetConstructors_native_raw,
// token 911,
ves_icall_System_RuntimeType_CreateInstanceInternal_raw,
// token 912,
ves_icall_RuntimeType_GetDeclaringMethod_raw,
// token 914,
ves_icall_System_RuntimeType_getFullName_raw,
// token 915,
ves_icall_RuntimeType_GetGenericArgumentsInternal_raw,
// token 918,
ves_icall_RuntimeType_GetGenericParameterPosition,
// token 919,
ves_icall_RuntimeType_GetEvents_native_raw,
// token 920,
ves_icall_RuntimeType_GetFields_native_raw,
// token 923,
ves_icall_RuntimeType_GetInterfaces_raw,
// token 925,
ves_icall_RuntimeType_GetNestedTypes_native_raw,
// token 928,
ves_icall_RuntimeType_GetDeclaringType_raw,
// token 930,
ves_icall_RuntimeType_GetName_raw,
// token 932,
ves_icall_RuntimeType_GetNamespace_raw,
// token 941,
ves_icall_RuntimeType_FunctionPointerReturnAndParameterTypes_raw,
// token 1007,
ves_icall_RuntimeTypeHandle_GetAttributes,
// token 1009,
ves_icall_RuntimeTypeHandle_GetMetadataToken_raw,
// token 1011,
ves_icall_RuntimeTypeHandle_GetGenericTypeDefinition_impl_raw,
// token 1021,
ves_icall_RuntimeTypeHandle_GetCorElementType,
// token 1022,
ves_icall_RuntimeTypeHandle_HasInstantiation,
// token 1023,
ves_icall_RuntimeTypeHandle_IsInstanceOfType_raw,
// token 1025,
ves_icall_RuntimeTypeHandle_HasReferences_raw,
// token 1031,
ves_icall_RuntimeTypeHandle_GetArrayRank_raw,
// token 1032,
ves_icall_RuntimeTypeHandle_GetAssembly_raw,
// token 1033,
ves_icall_RuntimeTypeHandle_GetElementType_raw,
// token 1034,
ves_icall_RuntimeTypeHandle_GetModule_raw,
// token 1035,
ves_icall_RuntimeTypeHandle_GetBaseType_raw,
// token 1043,
ves_icall_RuntimeTypeHandle_type_is_assignable_from_raw,
// token 1044,
ves_icall_RuntimeTypeHandle_IsGenericTypeDefinition,
// token 1045,
ves_icall_RuntimeTypeHandle_GetGenericParameterInfo_raw,
// token 1049,
ves_icall_RuntimeTypeHandle_is_subclass_of_raw,
// token 1050,
ves_icall_RuntimeTypeHandle_IsByRefLike_raw,
// token 1052,
ves_icall_System_RuntimeTypeHandle_internal_from_name_raw,
// token 1056,
ves_icall_System_String_FastAllocateString_raw,
// token 1057,
ves_icall_System_String_InternalIsInterned_raw,
// token 1058,
ves_icall_System_String_InternalIntern_raw,
// token 1355,
ves_icall_System_Type_internal_from_handle_raw,
// token 1543,
ves_icall_System_ValueType_InternalGetHashCode_raw,
// token 1544,
ves_icall_System_ValueType_Equals_raw,
// token 9163,
ves_icall_System_Threading_Interlocked_CompareExchange_Int,
// token 9164,
ves_icall_System_Threading_Interlocked_CompareExchange_Object,
// token 9166,
ves_icall_System_Threading_Interlocked_Decrement_Int,
// token 9167,
ves_icall_System_Threading_Interlocked_Increment_Int,
// token 9168,
ves_icall_System_Threading_Interlocked_Increment_Long,
// token 9169,
ves_icall_System_Threading_Interlocked_Exchange_Int,
// token 9170,
ves_icall_System_Threading_Interlocked_Exchange_Object,
// token 9172,
ves_icall_System_Threading_Interlocked_CompareExchange_Long,
// token 9173,
ves_icall_System_Threading_Interlocked_Exchange_Long,
// token 9174,
ves_icall_System_Threading_Interlocked_Add_Int,
// token 9175,
ves_icall_System_Threading_Interlocked_Add_Long,
// token 9193,
ves_icall_System_Threading_Monitor_Monitor_Enter_raw,
// token 9195,
mono_monitor_exit_icall_raw,
// token 9200,
ves_icall_System_Threading_Monitor_Monitor_pulse_raw,
// token 9202,
ves_icall_System_Threading_Monitor_Monitor_pulse_all_raw,
// token 9204,
ves_icall_System_Threading_Monitor_Monitor_wait_raw,
// token 9206,
ves_icall_System_Threading_Monitor_Monitor_try_enter_with_atomic_var_raw,
// token 9257,
ves_icall_System_Threading_Thread_InitInternal_raw,
// token 9258,
ves_icall_System_Threading_Thread_GetCurrentThread,
// token 9260,
ves_icall_System_Threading_InternalThread_Thread_free_internal_raw,
// token 9261,
ves_icall_System_Threading_Thread_GetState_raw,
// token 9262,
ves_icall_System_Threading_Thread_SetState_raw,
// token 9263,
ves_icall_System_Threading_Thread_ClrState_raw,
// token 9264,
ves_icall_System_Threading_Thread_SetName_icall_raw,
// token 9266,
ves_icall_System_Threading_Thread_YieldInternal,
// token 9268,
ves_icall_System_Threading_Thread_SetPriority_raw,
// token 10292,
ves_icall_System_Runtime_Loader_AssemblyLoadContext_PrepareForAssemblyLoadContextRelease_raw,
// token 10296,
ves_icall_System_Runtime_Loader_AssemblyLoadContext_GetLoadContextForAssembly_raw,
// token 10298,
ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalLoadFile_raw,
// token 10299,
ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalInitializeNativeALC_raw,
// token 10300,
ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalLoadFromStream_raw,
// token 10301,
ves_icall_System_Runtime_Loader_AssemblyLoadContext_InternalGetLoadedAssemblies_raw,
// token 10740,
ves_icall_System_GCHandle_InternalAlloc_raw,
// token 10741,
ves_icall_System_GCHandle_InternalFree_raw,
// token 10742,
ves_icall_System_GCHandle_InternalGet_raw,
// token 10743,
ves_icall_System_GCHandle_InternalSet_raw,
// token 10761,
ves_icall_System_Runtime_InteropServices_Marshal_GetLastPInvokeError,
// token 10762,
ves_icall_System_Runtime_InteropServices_Marshal_SetLastPInvokeError,
// token 10763,
ves_icall_System_Runtime_InteropServices_Marshal_StructureToPtr_raw,
// token 10866,
ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_InternalGetHashCode_raw,
// token 10869,
ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_GetObjectValue_raw,
// token 10877,
ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_GetUninitializedObjectInternal_raw,
// token 10878,
ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_InitializeArray_raw,
// token 10879,
ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_GetSpanDataFrom_raw,
// token 10880,
ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_SufficientExecutionStack,
// token 10881,
ves_icall_System_Runtime_CompilerServices_RuntimeHelpers_InternalBox_raw,
// token 11181,
ves_icall_System_Reflection_Assembly_GetExecutingAssembly_raw,
// token 11182,
ves_icall_System_Reflection_Assembly_GetEntryAssembly_raw,
// token 11187,
ves_icall_System_Reflection_Assembly_InternalLoad_raw,
// token 11188,
ves_icall_System_Reflection_Assembly_InternalGetType_raw,
// token 11218,
ves_icall_System_Reflection_AssemblyName_GetNativeName,
// token 11244,
ves_icall_MonoCustomAttrs_GetCustomAttributesInternal_raw,
// token 11251,
ves_icall_MonoCustomAttrs_GetCustomAttributesDataInternal_raw,
// token 11258,
ves_icall_MonoCustomAttrs_IsDefinedInternal_raw,
// token 11269,
ves_icall_System_Reflection_FieldInfo_internal_from_handle_type_raw,
// token 11272,
ves_icall_System_Reflection_FieldInfo_get_marshal_info_raw,
// token 11297,
ves_icall_System_Reflection_LoaderAllocatorScout_Destroy,
// token 11383,
ves_icall_System_Reflection_RuntimeAssembly_GetInfo_raw,
// token 11385,
ves_icall_System_Reflection_Assembly_GetManifestModuleInternal_raw,
// token 11386,
ves_icall_System_Reflection_RuntimeAssembly_GetModulesInternal_raw,
// token 11392,
ves_icall_System_Reflection_RuntimeCustomAttributeData_ResolveArgumentsInternal_raw,
// token 11400,
ves_icall_RuntimeEventInfo_get_event_info_raw,
// token 11419,
ves_icall_reflection_get_token_raw,
// token 11420,
ves_icall_System_Reflection_EventInfo_internal_from_handle_type_raw,
// token 11428,
ves_icall_RuntimeFieldInfo_ResolveType_raw,
// token 11430,
ves_icall_RuntimeFieldInfo_GetParentType_raw,
// token 11437,
ves_icall_RuntimeFieldInfo_GetFieldOffset_raw,
// token 11438,
ves_icall_RuntimeFieldInfo_GetValueInternal_raw,
// token 11441,
ves_icall_RuntimeFieldInfo_SetValueInternal_raw,
// token 11443,
ves_icall_RuntimeFieldInfo_GetRawConstantValue_raw,
// token 11447,
ves_icall_reflection_get_token_raw,
// token 11453,
ves_icall_get_method_info_raw,
// token 11454,
ves_icall_get_method_attributes,
// token 11461,
ves_icall_System_Reflection_MonoMethodInfo_get_parameter_info_raw,
// token 11463,
ves_icall_System_MonoMethodInfo_get_retval_marshal_raw,
// token 11475,
ves_icall_System_Reflection_RuntimeMethodInfo_GetMethodFromHandleInternalType_native_raw,
// token 11478,
ves_icall_RuntimeMethodInfo_get_name_raw,
// token 11479,
ves_icall_RuntimeMethodInfo_get_base_method_raw,
// token 11480,
ves_icall_reflection_get_token_raw,
// token 11491,
ves_icall_InternalInvoke_raw,
// token 11501,
ves_icall_RuntimeMethodInfo_GetPInvoke_raw,
// token 11507,
ves_icall_RuntimeMethodInfo_MakeGenericMethod_impl_raw,
// token 11508,
ves_icall_RuntimeMethodInfo_GetGenericArguments_raw,
// token 11509,
ves_icall_RuntimeMethodInfo_GetGenericMethodDefinition_raw,
// token 11511,
ves_icall_RuntimeMethodInfo_get_IsGenericMethodDefinition_raw,
// token 11512,
ves_icall_RuntimeMethodInfo_get_IsGenericMethod_raw,
// token 11528,
ves_icall_InvokeClassConstructor_raw,
// token 11530,
ves_icall_InternalInvoke_raw,
// token 11544,
ves_icall_reflection_get_token_raw,
// token 11565,
ves_icall_System_Reflection_RuntimeModule_GetGuidInternal_raw,
// token 11566,
ves_icall_System_Reflection_RuntimeModule_ResolveMethodToken_raw,
// token 11591,
ves_icall_RuntimeParameterInfo_GetTypeModifiers_raw,
// token 11596,
ves_icall_RuntimePropertyInfo_get_property_info_raw,
// token 11625,
ves_icall_reflection_get_token_raw,
// token 11626,
ves_icall_System_Reflection_RuntimePropertyInfo_internal_from_handle_type_raw,
// token 12182,
ves_icall_CustomAttributeBuilder_GetBlob_raw,
// token 12196,
ves_icall_DynamicMethod_create_dynamic_method_raw,
// token 12282,
ves_icall_AssemblyBuilder_basic_init_raw,
// token 12283,
ves_icall_AssemblyBuilder_UpdateNativeCustomAttributes_raw,
// token 12502,
ves_icall_ModuleBuilder_basic_init_raw,
// token 12503,
ves_icall_ModuleBuilder_set_wrappers_type_raw,
// token 12510,
ves_icall_ModuleBuilder_getUSIndex_raw,
// token 12511,
ves_icall_ModuleBuilder_getToken_raw,
// token 12512,
ves_icall_ModuleBuilder_getMethodToken_raw,
// token 12518,
ves_icall_ModuleBuilder_RegisterToken_raw,
// token 12587,
ves_icall_TypeBuilder_create_runtime_class_raw,
// token 13050,
ves_icall_System_IO_Stream_HasOverriddenBeginEndRead_raw,
// token 13051,
ves_icall_System_IO_Stream_HasOverriddenBeginEndWrite_raw,
// token 13309,
ves_icall_System_Diagnostics_Debugger_IsAttached_internal,
// token 13313,
ves_icall_System_Diagnostics_StackFrame_GetFrameInfo,
// token 13323,
ves_icall_System_Diagnostics_StackTrace_GetTrace,
// token 14160,
ves_icall_Mono_RuntimeClassHandle_GetTypeFromClass,
// token 14181,
ves_icall_Mono_RuntimeGPtrArrayHandle_GPtrArrayFree,
// token 14183,
ves_icall_Mono_SafeStringMarshal_StringToUtf8,
// token 14185,
ves_icall_Mono_SafeStringMarshal_GFree,
};
static uint8_t corlib_icall_flags [] = {
0,
0,
0,
0,
0,
4,
4,
0,
4,
0,
4,
4,
4,
0,
0,
0,
4,
4,
4,
4,
0,
4,
0,
0,
0,
4,
0,
4,
4,
4,
4,
0,
4,
4,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
4,
4,
4,
0,
4,
4,
0,
0,
4,
4,
4,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
0,
4,
4,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
0,
0,
4,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
0,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
4,
0,
0,
0,
0,
0,
0,
0,
};
